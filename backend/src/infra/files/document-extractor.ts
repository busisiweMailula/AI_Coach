import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import {
  AppError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../../common/errors.js";
import { env } from "../../config/env.js";

export type AcceptedDocumentKind = "pdf" | "docx" | "txt";

export interface ExtractedDocument {
  kind: AcceptedDocumentKind;
  contentType: string;
  text: string;
}

const MIME_TYPES: Record<AcceptedDocumentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export async function extractDocument(
  buffer: Buffer,
  originalName: string,
  declaredMimeType: string,
  allowedKinds: readonly AcceptedDocumentKind[],
): Promise<ExtractedDocument> {
  if (buffer.length === 0) throw new ValidationError("Uploaded file is empty");
  if (buffer.length > env.MAX_UPLOAD_BYTES) throw new PayloadTooLargeError();

  const extension = pathExtension(originalName);
  if (!allowedKinds.includes(extension as AcceptedDocumentKind)) {
    throw new UnsupportedMediaTypeError("Only supported PDF, DOCX, or text files are accepted");
  }
  const kind = extension as AcceptedDocumentKind;

  if (kind === "pdf") {
    const pdfHeaderOffset = buffer.subarray(0, 1024).indexOf(Buffer.from("%PDF-"));
    if (pdfHeaderOffset < 0) {
      throw new UnsupportedMediaTypeError("The uploaded file is not a valid PDF");
    }
    assertDeclaredMime(declaredMimeType, [MIME_TYPES.pdf]);
    return { kind, contentType: MIME_TYPES.pdf, text: await extractPdf(buffer) };
  }

  if (kind === "docx") {
    assertDeclaredMime(declaredMimeType, [MIME_TYPES.docx, "application/zip"]);
    await inspectDocxArchive(buffer);
    return { kind, contentType: MIME_TYPES.docx, text: await extractDocx(buffer) };
  }

  assertDeclaredMime(declaredMimeType, [MIME_TYPES.txt, "application/octet-stream"]);
  const text = decodeText(buffer);
  return { kind, contentType: MIME_TYPES.txt, text: normalizeText(text) };
}

function pathExtension(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  const match = /\.([a-z0-9]+)$/i.exec(normalized);
  return match?.[1].toLowerCase() ?? "";
}

function assertDeclaredMime(mime: string, accepted: string[]): void {
  const normalized = mime.split(";")[0].trim().toLowerCase();
  if (normalized && !accepted.includes(normalized)) {
    throw new UnsupportedMediaTypeError("File extension, content, and media type do not match");
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  let document: Awaited<ReturnType<typeof getDocument>["promise"]> | undefined;
  try {
    const task = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    document = await task.promise;
    if (document.numPages > env.MAX_PDF_PAGES) {
      throw new PayloadTooLargeError("PDF exceeds the configured page limit");
    }

    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item) => "str" in item)
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      lines.push(pageText);
      page.cleanup();
    }
    return normalizeText(lines.join("\n"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError("Could not extract text from the PDF");
  } finally {
    await document?.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return normalizeText(result.value);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError("Could not extract text from the DOCX document");
  }
}

function decodeText(buffer: Buffer): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (decoded.includes("\0")) throw new Error("NUL byte in text document");
    return decoded.replace(/^\uFEFF/, "");
  } catch {
    throw new ValidationError("Text upload must contain valid UTF-8 text");
  }
}

function normalizeText(text: string): string {
  const normalized = text
    .replace(/\u0000/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length > env.MAX_EXTRACTED_TEXT_CHARS) {
    throw new PayloadTooLargeError("Extracted text exceeds the configured limit");
  }
  return normalized;
}

function inspectDocxArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(new ValidationError("DOCX archive is malformed"));
          return;
        }
        scanDocxEntries(zipFile, resolve, reject);
      },
    );
  });
}

function scanDocxEntries(
  zipFile: ZipFile,
  resolve: () => void,
  reject: (error: Error) => void,
): void {
  let count = 0;
  let uncompressedBytes = 0;
  let hasContentTypes = false;
  let hasDocumentXml = false;
  let settled = false;

  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    zipFile.close();
    reject(error);
  };

  zipFile.on("error", () => fail(new ValidationError("DOCX archive is malformed")));
  zipFile.on("entry", (entry: Entry) => {
    count += 1;
    uncompressedBytes += entry.uncompressedSize;
    const entryName = entry.fileName.replace(/\\/g, "/");

    if (
      count > env.MAX_DOCX_ENTRIES ||
      uncompressedBytes > env.MAX_DOCX_UNCOMPRESSED_BYTES
    ) {
      fail(new PayloadTooLargeError("DOCX archive exceeds configured processing limits"));
      return;
    }
    if (
      entry.isEncrypted() ||
      entryName.startsWith("/") ||
      entryName.split("/").includes("..")
    ) {
      fail(new ValidationError("DOCX archive contains an unsafe entry"));
      return;
    }
    if (entryName === "[Content_Types].xml") hasContentTypes = true;
    if (entryName === "word/document.xml") hasDocumentXml = true;
    zipFile.readEntry();
  });
  zipFile.on("end", () => {
    if (settled) return;
    settled = true;
    if (!hasContentTypes || !hasDocumentXml) {
      reject(new UnsupportedMediaTypeError("ZIP file is not a DOCX document"));
      return;
    }
    resolve();
  });
  zipFile.readEntry();
}
