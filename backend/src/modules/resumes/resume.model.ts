import type { ObjectId } from "mongodb";
import type { StructuredCv } from "./structured-cv.js";

export type ResumeParseStatus = "uploaded" | "queued" | "parsed" | "failed";

export interface ResumeDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  extractedText: string;
  structuredCv?: StructuredCv;
  textExtractionStatus: "extracted" | "empty";
  parseStatus: ResumeParseStatus;
  parseJobId?: ObjectId;
  parsedResumeDataId?: ObjectId;
  parserVersion?: string;
  title?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResumeMetadataUpdate {
  title?: string;
  notes?: string;
}

