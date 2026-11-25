import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { ObjectId } from "mongodb";
import { ValidationError } from "../../common/errors.js";
import type { AsyncJobDocument } from "../../infra/jobs/job.model.js";
import { getDb } from "../../infra/db/database.js";
import { env } from "../../config/env.js";
import { scheduleAgentJob } from "../../infra/jobs/job-queue.js";
import { logger } from "../../config/logger.js";
import { extractDocument } from "../../infra/files/document-extractor.js";
import { LocalFileStorage } from "../../infra/storage/local-file-storage.js";
import type { ResumeDocument, ResumeMetadataUpdate } from "./resume.model.js";
import { structureCv, type StructuredCv } from "./structured-cv.js";
import { deleteResume, findParsedResumeData, findResume, insertResume, listResumes, updateResume } from "./resumes.repository.js";

const storage = new LocalFileStorage();

export async function uploadResume(input: {
  ownerId: string;
  originalName: string;
  declaredMimeType: string;
  buffer: Buffer;
}): Promise<ResumeDocument> {
  const ownerId = new ObjectId(input.ownerId);
  const extracted = await extractDocument(
    input.buffer,
    input.originalName,
    input.declaredMimeType,
    ["pdf", "docx"],
  );
  const fileName = sanitizeFileName(input.originalName);
  const id = new ObjectId();
  const parseJobId = env.LLM_PROVIDER === "disabled" ? undefined : new ObjectId();
  const storageKey = `resumes/${ownerId.toHexString()}/${randomUUID()}.${extracted.kind}`;
  const now = new Date();

  const resume: ResumeDocument = {
    _id: id,
    ownerId,
    originalFileName: fileName,
    contentType: extracted.contentType,
    sizeBytes: input.buffer.length,
    sha256: createHash("sha256").update(input.buffer).digest("hex"),
    storageKey,
    extractedText: extracted.text,
    structuredCv: structureCv(extracted.sourceLines),
    textExtractionStatus: extracted.text ? "extracted" : "empty",
    parseStatus: parseJobId ? "queued" : "uploaded",
    ...(parseJobId ? { parseJobId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await storage.put(storageKey, input.buffer);
  try {
    await insertResume(resume);
    if (parseJobId) {
      const job: AsyncJobDocument = {
        _id: parseJobId,
        ownerId,
        type: "resume_parse",
        status: "queued",
        progress: 0,
        attempt: 0,
        resultType: "parsed_resume_data",
        resultId: id,
        safeErrorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      await getDb().collection<AsyncJobDocument>("jobs").insertOne(job);
      scheduleAgentJob(parseJobId);
    }
  } catch (error) {
    try {
      await deleteResume(id, ownerId);
      await storage.delete(storageKey);
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, resumeId: id.toHexString() },
        "Failed to clean up file after resume persistence failure",
      );
    }
    throw error;
  }

  return resume;
}

export async function getResume(resumeId: string, ownerId: string): Promise<ResumeDocument> {
  return findResume(resumeId, new ObjectId(ownerId));
}

export async function getOriginalResumeFile(resume: ResumeDocument): Promise<Buffer> {
  return storage.get(resume.storageKey);
}

export async function ensureResumeStructuredCv(resume: ResumeDocument): Promise<StructuredCv> {
  if (resume.structuredCv) {
    if (!resume.structuredCv.lossless.verified) {
      throw new ValidationError("The CV structure could not be verified against its source text");
    }
    return resume.structuredCv;
  }
  const buffer = await getOriginalResumeFile(resume);
  const extracted = await extractDocument(
    buffer,
    resume.originalFileName,
    resume.contentType,
    ["pdf", "docx"],
  );
  if (extracted.text !== resume.extractedText) {
    throw new ValidationError("The stored resume text no longer matches its original file");
  }
  const structuredCv = structureCv(extracted.sourceLines);
  if (!structuredCv.lossless.verified) {
    throw new ValidationError("The CV structure could not be verified against its source file");
  }
  await getDb().collection<ResumeDocument>("resumes").updateOne(
    { _id: resume._id, ownerId: resume.ownerId, structuredCv: { $exists: false } },
    { $set: { structuredCv, updatedAt: new Date() } },
  );
  return structuredCv;
}

export async function getResumes(ownerId: string): Promise<ResumeDocument[]> {
  return listResumes(new ObjectId(ownerId));
}

export async function patchResume(
  resumeId: string,
  ownerId: string,
  update: ResumeMetadataUpdate,
): Promise<ResumeDocument> {
  return updateResume(resumeId, new ObjectId(ownerId), update);
}

export async function getParsedResumeData(resume: ResumeDocument, ownerId: string) {
  if (!resume.parsedResumeDataId) return null;
  return findParsedResumeData(resume.parsedResumeDataId, new ObjectId(ownerId));
}

function sanitizeFileName(name: string): string {
  const baseName = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const safeName = baseName.replace(/[\u0000-\u001f\u007f]/g, "_").trim().slice(0, 255);
  return safeName || `resume${path.extname(name).toLowerCase()}`;
}

