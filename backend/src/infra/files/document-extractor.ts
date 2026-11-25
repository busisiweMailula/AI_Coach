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
  sourceLines: Array<{ text: string; kind?: "paragraph" | "bullet" | "date"; bold?: boolean; heading?: boolean }>;
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
    const sourceLines = await extractPdf(buffer);
    return { kind, contentType: MIME_TYPES.pdf, text: normalizeText(sourceLines.map((line) => line.text).join("\n")), sourceLines };
  }

  if (kind === "docx") {
    assertDeclaredMime(declaredMimeType, [MIME_TYPES.docx, "application/zip"]);
    await inspectDocxArchive(buffer);
    const sourceLines = await extractDocx(buffer);
    return { kind, contentType: MIME_TYPES.docx, text: normalizeText(sourceLines.map((line) => line.text).join("\n")), sourceLines };
  }

  assertDeclaredMime(declaredMimeType, [MIME_TYPES.txt, "application/octet-stream"]);
  const text = decodeText(buffer);
  const normalized = normalizeText(text);
  return {
    kind,
    contentType: MIME_TYPES.txt,
    text: normalized,
    sourceLines: normalized.split("\n").map((line) => ({ text: line })),
  };
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

async function extractPdf(buffer: Buffer): Promise<Array<{ text: string; kind?: "paragraph" | "bullet" | "date"; bold?: boolean; heading?: boolean }>> {
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

    const lines: Array<{ text: string; y: number; x: number; bold: boolean }> = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !("transform" in item)) continue;
        const fontName = item.fontName.toLocaleLowerCase("en");
        lines.push({
          text: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          bold: fontName.includes("bold") || fontName.includes("black"),
        });
      }
      page.cleanup();
    }
    lines.sort((left, right) => Math.abs(right.y - left.y) > 2 ? right.y - left.y : left.x - right.x);
    const rows: Array<{ y: number; pieces: typeof lines }> = [];
    for (const line of lines) {
      const row = rows.find((candidate) => Math.abs(candidate.y - line.y) <= 2);
      if (row) row.pieces.push(line);
      else rows.push({ y: line.y, pieces: [line] });
    }
    return rows.map(({ pieces }) => {
      pieces.sort((left, right) => left.x - right.x);
      const text = pieces.map((piece) => piece.text).join(" ").trim();
      const bullet = /^(?:[•▪●*-])\s+/.test(text);
      return {
        text,
        ...(bullet ? { kind: "bullet" as const } : /\b(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current)\b/i.test(text)
          ? { kind: "date" as const }
          : {}),
        ...(pieces.some((piece) => piece.bold) ? { bold: true } : {}),
        ...(pieces.some((piece) => piece.bold) && pieces.some((piece) => piece.text.length > 0) ? { heading: true } : {}),
      };
    }).filter((line) => line.text.length > 0);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError("Could not extract text from the PDF");
  } finally {
    await document?.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<Array<{ text: string; kind?: "paragraph" | "bullet" | "date"; bold?: boolean; heading?: boolean }>> {
  try {
    const [xml, stylesXml] = await Promise.all([
      readDocxXmlEntry(buffer, "word/document.xml", true),
      readDocxXmlEntry(buffer, "word/styles.xml", false),
    ]);
    return extractDocxParagraphs(xml, headingStyleIds(stylesXml));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError("Could not extract text from the DOCX document");
  }

  function extractDocxParagraphs(xml: string, headingStyles: Set<string>): Array<{ text: string; kind?: "paragraph" | "bullet" | "date"; bold?: boolean; heading?: boolean }> {
    const result: Array<{ text: string; kind?: "paragraph" | "bullet" | "date"; bold?: boolean; heading?: boolean }> = [];
    for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
      const paragraph = match[1] ?? "";
      const text = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g)]
        .map((part) => part[1] !== undefined ? decodeXml(part[1]) : part[0].startsWith("<w:tab") ? "\t" : "\n")
        .join("")
        .trim();
      if (!text) continue;
      const isBullet = /<w:numPr\b/.test(paragraph);
      const styleId = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(paragraph)?.[1] ?? "";
      const isHeading = /^heading\d*$/i.test(styleId) || headingStyles.has(styleId) || /<w:outlineLvl\b/.test(paragraph);
      const isRightAligned = /<w:jc\b[^>]*w:val="(?:right|end)"/.test(paragraph);
      const dateText = /\b(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current)\b/i.test(text);
      result.push({
        text,
        ...(isBullet ? { kind: "bullet" as const } : isRightAligned || dateText ? { kind: "date" as const } : {}),
        ...(/<w:b(?:\s[^>]*)?\/>/.test(paragraph) || /<w:b\b[^>]*w:val="(?:1|true|on)"/.test(paragraph)
          ? { bold: true }
          : {}),
        ...(isHeading ? { heading: true } : {}),
      });
    }
    return result;
  }

  function headingStyleIds(stylesXml: string): Set<string> {
    const ids = new Set<string>();
    for (const style of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
      const attributes = style[1] ?? "";
      const body = style[2] ?? "";
      const id = /\bw:styleId="([^"]+)"/.exec(attributes)?.[1];
      const name = /<w:name\b[^>]*w:val="([^"]+)"/.exec(body)?.[1] ?? "";
      const basedOn = /<w:basedOn\b[^>]*w:val="([^"]+)"/.exec(body)?.[1] ?? "";
      if (id && (/^heading\s*\d/i.test(name) || /^heading\d*$/i.test(basedOn))) ids.add(id);
    }
    return ids;
  }

  function decodeXml(value: string): string {
    return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" };
      const normalized = entity.toLocaleLowerCase("en");
      if (entities[normalized]) return entities[normalized] ?? entity;
      const numeric = /^&#(?:x([\da-f]+)|(\d+));$/i.exec(entity);
      if (!numeric) return entity;
      return String.fromCodePoint(Number.parseInt(numeric[1] ?? numeric[2] ?? "0", numeric[1] ? 16 : 10));
    });
  }

  function readDocxXmlEntry(buffer: Buffer, targetName: string, required: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zipFile) => {
        if (error || !zipFile) {
          reject(new ValidationError("DOCX archive is malformed"));
          return;
        }
        let settled = false;
        zipFile.on("error", () => {
          if (!settled) reject(new ValidationError("Could not read the DOCX document"));
          settled = true;
        });
        zipFile.on("entry", (entry) => {
          if (entry.fileName.replace(/\\/g, "/") !== targetName) {
            zipFile.readEntry();
            return;
          }
          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              settled = true;
              zipFile.close();
              reject(new ValidationError("Could not read the DOCX document"));
              return;
            }
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("error", () => {
              settled = true;
              zipFile.close();
              reject(new ValidationError("Could not read the DOCX document"));
            });
            stream.on("end", () => {
              if (settled) return;
              settled = true;
              zipFile.close();
              resolve(Buffer.concat(chunks).toString("utf8"));
            });
          });
        });
        zipFile.on("end", () => {
          if (!settled && required) {
            settled = true;
            reject(new ValidationError("DOCX XML entry is missing"));
          } else if (!settled) {
            settled = true;
            resolve("");
          }
        });
        zipFile.readEntry();
      });
    });
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
