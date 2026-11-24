import mammoth from "mammoth";
import { DOMParser } from "@xmldom/xmldom";
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
  lines: Array<{
    text: string;
    kind?: "paragraph" | "bullet";
    bold?: boolean;
    fontSize?: number;
    alignRight?: boolean;
    styleName?: string;
  }>;
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
    const extracted = await extractPdf(buffer);
    return { kind, contentType: MIME_TYPES.pdf, ...extracted };
  }

  if (kind === "docx") {
    assertDeclaredMime(declaredMimeType, [MIME_TYPES.docx, "application/zip"]);
    await inspectDocxArchive(buffer);
    const [text, lines] = await Promise.all([extractDocx(buffer), extractDocxLines(buffer)]);
    return { kind, contentType: MIME_TYPES.docx, text, lines };
  }

  assertDeclaredMime(declaredMimeType, [MIME_TYPES.txt, "application/octet-stream"]);
  const text = decodeText(buffer);
  const normalized = normalizeText(text);
  return {
    kind,
    contentType: MIME_TYPES.txt,
    text: normalized,
    lines: normalized.split("\n").map((line) => ({ text: line })),
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

async function extractPdf(buffer: Buffer): Promise<{
  text: string;
  lines: ExtractedDocument["lines"];
}> {
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

    const lines: ExtractedDocument["lines"] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items.filter((item) => "str" in item && item.str.trim()).map((item) => {
        const fontName = "fontName" in item ? item.fontName : "";
        const transform = "transform" in item ? item.transform : [1, 0, 0, 1, 0, 0];
        return {
          text: "str" in item ? item.str : "",
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          fontSize: Math.abs(transform[3] ?? 0),
          bold: /bold|black|demi|semibold/i.test(fontName),
        };
      }).sort((left, right) => right.y - left.y || left.x - right.x);
      let currentY: number | undefined;
      let currentLine: typeof positioned = [];
      const flushLine = () => {
        if (currentLine.length === 0) return;
        const firstX = currentLine[0].x;
        const maxX = currentLine.reduce((maximum, item) => Math.max(maximum, item.x), firstX);
        const text = currentLine.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
        lines.push({
          text,
          kind: /^\s*[•▪●◦]\s*/.test(text) ? "bullet" : "paragraph",
          bold: currentLine.some((item) => item.bold),
          fontSize: Math.max(...currentLine.map((item) => item.fontSize)),
          alignRight: firstX > page.view[2] * 0.62 || maxX > page.view[2] * 0.88,
        });
        currentLine = [];
      };
      for (const item of positioned) {
        if (currentY !== undefined && Math.abs(currentY - item.y) > 2.5) flushLine();
        currentY = item.y;
        currentLine.push(item);
      }
      flushLine();
      page.cleanup();
    }
    const normalizedLines = lines.filter((line) => line.text);
    return {
      text: normalizeText(normalizedLines.map((line) => line.text).join("\n")),
      lines: normalizedLines,
    };
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

async function extractDocxLines(buffer: Buffer): Promise<ExtractedDocument["lines"]> {
  const xml = await readZipEntry(buffer, "word/document.xml");
  try {
    const document = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: (message) => { throw new Error(message); },
        fatalError: (message) => { throw new Error(message); },
      },
    }).parseFromString(xml, "application/xml");
    const stylesXml = await readZipEntry(buffer, "word/styles.xml", true);
    const numberingXml = await readZipEntry(buffer, "word/numbering.xml", true);
    const stylesDocument = stylesXml ? parseDocxXml(stylesXml) : undefined;
    const numberingDocument = numberingXml ? parseDocxXml(numberingXml) : undefined;
    const bulletNumberIds = findBulletNumberIds(numberingDocument);
    const styleNumberIds = findStyleNumberIds(stylesDocument);
    const paragraphs = Array.from(document.getElementsByTagNameNS("*", "p"));
    return paragraphs.map((paragraph) => {
      const properties = paragraph.getElementsByTagNameNS("*", "pPr").item(0);
      const styleId = properties?.getElementsByTagNameNS("*", "pStyle").item(0)?.getAttributeNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "val",
      ) ?? undefined;
      const styleName = styleId
        ? findStyleName(stylesDocument, styleId) ?? styleId
        : undefined;
      const alignment = properties?.getElementsByTagNameNS("*", "jc").item(0)?.getAttributeNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "val",
      );
      const directNumId = properties?.getElementsByTagNameNS("*", "numPr").item(0)
        ?.getElementsByTagNameNS("*", "numId").item(0)?.getAttributeNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "val",
        );
      const numId = directNumId ?? (styleId ? styleNumberIds.get(styleId) : undefined);
      const isBullet = numId !== undefined && bulletNumberIds.has(numId);
      const runs = Array.from(paragraph.getElementsByTagNameNS("*", "r"));
      let bold = false;
      let fontSize = 0;
      let text = "";
      for (const run of runs) {
        const runProperties = run.getElementsByTagNameNS("*", "rPr").item(0);
        bold ||= Boolean(runProperties?.getElementsByTagNameNS("*", "b").length);
        const size = runProperties?.getElementsByTagNameNS("*", "sz").item(0)?.getAttributeNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "val",
        );
        if (size) fontSize = Math.max(fontSize, Number(size) / 2);
        for (const node of Array.from(run.childNodes)) {
          if (node.nodeType !== 1) continue;
          const element = node as Element;
          if (element.localName === "t") text += element.textContent ?? "";
          else if (element.localName === "tab") text += "\t";
          else if (element.localName === "br" || element.localName === "cr") text += "\n";
        }
      }
      return {
        text: text.trim(),
        kind: isBullet ? "bullet" as const : "paragraph" as const,
        bold,
        ...(fontSize ? { fontSize } : {}),
        alignRight: alignment === "right" || alignment === "end",
        ...(styleName ? { styleName } : {}),
      };
    }).filter((line) => line.text);
  } catch {
    throw new ValidationError("Could not extract structured paragraphs from the DOCX document");
  }
}

function parseDocxXml(xml: string): Document {
  const parsed = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => { throw new Error(message); },
      fatalError: (message) => { throw new Error(message); },
    },
  }).parseFromString(xml, "application/xml");
  return parsed;
}

function findBulletNumberIds(document: Document | undefined): Set<string> {
  const result = new Set<string>();
  if (!document) return result;
  const bulletAbstractIds = new Set<string>();
  for (const abstract of Array.from(document.getElementsByTagNameNS("*", "abstractNum"))) {
    const abstractId = abstract.getAttributeNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "abstractNumId",
    );
    const levels = Array.from(abstract.getElementsByTagNameNS("*", "lvl"));
    const hasBulletLevel = levels.some((level) => level.getElementsByTagNameNS("*", "numFmt").item(0)?.getAttributeNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "val",
    ) === "bullet");
    if (abstractId && hasBulletLevel) bulletAbstractIds.add(abstractId);
  }
  for (const number of Array.from(document.getElementsByTagNameNS("*", "num"))) {
    const id = number.getAttributeNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "numId",
    );
    const abstractId = number.getElementsByTagNameNS("*", "abstractNumId").item(0)?.getAttributeNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "val",
    );
    if (id && abstractId && bulletAbstractIds.has(abstractId)) result.add(id);
  }
  return result;
}

function findStyleNumberIds(document: Document | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!document) return result;
  for (const style of Array.from(document.getElementsByTagNameNS("*", "style"))) {
    const id = style.getAttributeNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "styleId",
    );
    const numId = style.getElementsByTagNameNS("*", "pPr").item(0)
      ?.getElementsByTagNameNS("*", "numPr").item(0)
      ?.getElementsByTagNameNS("*", "numId").item(0)?.getAttributeNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "val",
      );
    if (id && numId) result.set(id, numId);
  }
  return result;
}

function findStyleName(document: Document | undefined, styleId: string): string | undefined {
  if (!document) return undefined;
  const style = Array.from(document.getElementsByTagNameNS("*", "style")).find((item) =>
    item.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "styleId") === styleId);
  return style?.getElementsByTagNameNS("*", "name").item(0)?.getAttributeNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "val",
  ) ?? undefined;
}

function readZipEntry(buffer: Buffer, entryName: string, optional = false): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(new ValidationError("DOCX archive is malformed"));
        return;
      }
      zipFile.on("error", () => reject(new ValidationError("DOCX archive is malformed")));
      let found = false;
      zipFile.on("entry", (entry: Entry) => {
        if (entry.fileName.replace(/\\/g, "/") !== entryName) {
          zipFile.readEntry();
          return;
        }
        found = true;
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.close();
            reject(new ValidationError("Could not read the DOCX document XML"));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", () => {
            zipFile.close();
            reject(new ValidationError("Could not read the DOCX document XML"));
          });
          stream.on("end", () => {
            zipFile.close();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        });
        zipFile.on("end", () => {
          if (!found) {
            zipFile.close();
            if (optional) resolve("");
            else reject(new ValidationError("DOCX document XML is missing"));
          }
        });
      });
      zipFile.readEntry();
    });
  });
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
