import { readFile } from "node:fs/promises";
import { ObjectId, type Document } from "mongodb";

export interface LegacyCollection {
  name: string;
  documents: Document[];
}

export async function readLegacyJsonDatabase(filePath: string): Promise<LegacyCollection[]> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("Legacy JSON database must contain an object of collections");
  }

  return Object.entries(parsed).map(([name, value]) => {
    if (!Array.isArray(value)) {
      throw new Error(`Legacy JSON collection "${name}" must contain an array of documents`);
    }
    return {
      name,
      documents: value.map((document, index) => {
        if (!isRecord(document)) {
          throw new Error(`Legacy JSON collection "${name}" has a non-document at index ${index}`);
        }
        return decodeDocument(document);
      }),
    };
  });
}

function decodeDocument(document: Record<string, unknown>): Document {
  const decoded: Document = {};
  for (const [key, value] of Object.entries(document)) {
    decoded[key] = decodeLegacyValue(value);
  }
  return decoded;
}

function decodeLegacyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeLegacyValue);
  if (!isRecord(value)) return value;

  const entries = Object.entries(value);
  if (entries.length === 1 && typeof value.$oid === "string") {
    if (!/^[\da-f]{24}$/i.test(value.$oid)) {
      throw new Error("Legacy JSON database contains an invalid ObjectId");
    }
    return new ObjectId(value.$oid);
  }
  if (entries.length === 1 && typeof value.$date === "string") {
    const date = new Date(value.$date);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Legacy JSON database contains an invalid date");
    }
    return date;
  }

  return Object.fromEntries(entries.map(([key, nested]) => [key, decodeLegacyValue(nested)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
