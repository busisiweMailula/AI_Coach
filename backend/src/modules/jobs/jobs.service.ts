import { randomUUID } from "node:crypto";
import path from "node:path";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { extractDocument } from "../../infra/files/document-extractor.js";
import type { AsyncJobDocument } from "../../infra/jobs/job.model.js";
import { MongoGridFsStorage } from "../../infra/storage/mongodb-gridfs-storage.js";
import { scheduleAgentJob } from "../../infra/jobs/job-queue.js";
import { ValidationError } from "../../common/errors.js";
import type { JobDescriptionDocument } from "./job-description.model.js";
import {
  deleteJobDescription,
  findAsyncJob,
  findJobDescription,
  insertJobDescription,
  listJobDescriptions,
} from "./jobs.repository.js";

export const jobTextSchema = z.object({
  text: z.string().trim().min(20, "Job description must be at least 20 characters")
    .max(env.MAX_EXTRACTED_TEXT_CHARS),
}).strict();

const storage = new MongoGridFsStorage();

export async function submitJobDescription(input: {
  ownerId: string;
  text?: unknown;
  file?: {
    originalName: string;
    declaredMimeType: string;
    buffer: Buffer;
  };
}): Promise<{ description: JobDescriptionDocument; job: AsyncJobDocument }> {
  if ((!input.file && input.text === undefined) || (input.file && input.text !== undefined)) {
    throw new ValidationError("Provide either job description text or one file");
  }

  let text: string;
  let sourceType: "paste" | "upload";
  let sourceFileKey: string | null = null;
  let fileBuffer: Buffer | undefined;

  if (input.file) {
    const extracted = await extractDocument(
      input.file.buffer,
      input.file.originalName,
      input.file.declaredMimeType,
      ["pdf", "docx", "txt"],
    );
    text = extracted.text;
    sourceType = "upload";
    fileBuffer = input.file.buffer;
  } else {
    text = "";
    sourceType = "paste";
  }

  text = parseJobText(input.file ? text : input.text);
  const ownerId = new ObjectId(input.ownerId);
  const id = new ObjectId();
  const jobId = new ObjectId();
  const now = new Date();
  if (input.file && fileBuffer) {
    const extension = path.extname(input.file.originalName).toLowerCase().slice(1);
    sourceFileKey = `job-descriptions/${ownerId.toHexString()}/${randomUUID()}.${extension}`;
    await storage.put(sourceFileKey, fileBuffer);
  }

  const description: JobDescriptionDocument = {
    _id: id,
    ownerId,
    sourceType,
    sourceFileKey,
    rawText: text,
    normalizedText: text,
    analysisStatus: "queued",
    analysisJobId: jobId,
    createdAt: now,
    updatedAt: now,
  };
  const job: AsyncJobDocument = {
    _id: jobId,
    ownerId,
    type: "jd_analysis",
    status: "queued",
    progress: 0,
    attempt: 0,
    resultType: "job_description",
    resultId: id,
    safeErrorCode: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await insertJobDescription(description, job);
    scheduleAgentJob(jobId);
  } catch (error) {
    try {
      await deleteJobDescription(id, ownerId);
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, jobDescriptionId: id.toHexString() },
        "Failed to clean up job description after persistence failure",
      );
    }
    if (sourceFileKey) {
      try {
        await storage.delete(sourceFileKey);
      } catch (cleanupError) {
        logger.error(
          { err: cleanupError, jobDescriptionId: id.toHexString() },
          "Failed to clean up job description upload after persistence failure",
        );
      }
    }
    throw error;
  }

  return { description, job };
}

export async function listOwnedJobDescriptions(ownerId: string): Promise<JobDescriptionDocument[]> {
  return listJobDescriptions(new ObjectId(ownerId));
}

export async function getOwnedJobDescription(
  id: string,
  ownerId: string,
): Promise<JobDescriptionDocument> {
  return findJobDescription(id, new ObjectId(ownerId));
}

export async function getOwnedAsyncJob(id: string, ownerId: string): Promise<AsyncJobDocument> {
  return findAsyncJob(id, new ObjectId(ownerId));
}

function parseJobText(value: unknown): string {
  const parsed = jobTextSchema.safeParse({ text: value });
  if (!parsed.success) {
    throw new ValidationError("Job description text is invalid", parsed.error.flatten());
  }
  return parsed.data.text;
}
