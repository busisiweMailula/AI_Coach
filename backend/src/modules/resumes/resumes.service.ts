import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { ObjectId } from "mongodb";
import { ServiceUnavailableError, UpstreamServiceError } from "../../common/errors.js";
import { runAgent } from "../../agents/runtime/run-agent.js";
import type { AsyncJobDocument } from "../../infra/jobs/job.model.js";
import { getDb } from "../../infra/db/database.js";
import { env } from "../../config/env.js";
import { scheduleAgentJob } from "../../infra/jobs/job-queue.js";
import { logger } from "../../config/logger.js";
import { extractDocument } from "../../infra/files/document-extractor.js";
import { LocalFileStorage } from "../../infra/storage/local-file-storage.js";
import { NotFoundError } from "../../common/errors.js";
import type { ResumeDocument, ResumeMetadataUpdate } from "./resume.model.js";
import { deleteResume, findParsedResumeData, findResume, insertResume, listResumes, updateResume } from "./resumes.repository.js";
import {
  isStructuredCvLossless,
  hasOnlySourceDerivedFields,
  reseedStructuredCvIds,
  structureCv,
  structuredCvSchema,
  type CvSourceLine,
  type StructuredCv,
} from "./structured-cv.js";
import { getConsentStatus } from "../privacy/privacy.service.js";
import { prepareResumeTextForAI } from "../privacy/resume-anonymizer.js";

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
  const profile = await getDb().collection<{ _id: ObjectId; email: string }>("users")
    .findOne({ _id: ownerId }, { projection: { email: 1 } });
  const structuredCv = await structureWithoutDataLoss(extracted.text, extracted.lines, ownerId);
  if (profile?.email) structuredCv.header.email = profile.email;

  const resume: ResumeDocument = {
    _id: id,
    ownerId,
    originalFileName: fileName,
    contentType: extracted.contentType,
    sizeBytes: input.buffer.length,
    sha256: createHash("sha256").update(input.buffer).digest("hex"),
    storageKey,
    extractedText: extracted.text,
    structuredCv,
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

export async function getStructuredCv(resume: ResumeDocument): Promise<StructuredCv> {
  if (resume.structuredCv) return resume.structuredCv;

  let sourceLines: CvSourceLine[] | undefined;
  try {
    const storedFile = await storage.get(resume.storageKey);
    const extracted = await extractDocument(
      storedFile,
      resume.originalFileName,
      resume.contentType,
      ["pdf", "docx"],
    );
    sourceLines = extracted.lines;
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  const structuredCv = await structureWithoutDataLoss(resume.extractedText, sourceLines, resume.ownerId);
  const profile = await getDb().collection<{ _id: ObjectId; email: string }>("users")
    .findOne({ _id: resume.ownerId }, { projection: { email: 1 } });
  if (profile?.email) structuredCv.header.email = profile.email;
  await getDb().collection<ResumeDocument>("resumes").updateOne(
    { _id: resume._id, ownerId: resume.ownerId, structuredCv: { $exists: false } },
    { $set: { structuredCv, updatedAt: new Date() } },
  );
  return structuredCv;
}

export async function saveStructuredCv(
  resumeId: string,
  ownerId: string,
  structuredCv: StructuredCv,
): Promise<StructuredCv> {
  const resume = await findResume(resumeId, new ObjectId(ownerId));
  await getDb().collection<ResumeDocument>("resumes").updateOne(
    { _id: resume._id, ownerId: resume.ownerId },
    { $set: { structuredCv, updatedAt: new Date() } },
  );
  return structuredCv;
}

async function structureWithoutDataLoss(
  sourceText: string,
  lines: CvSourceLine[] | undefined,
  ownerId: ObjectId,
): Promise<StructuredCv> {
  const structuredCv = structureCv(sourceText, lines);
  if (!structuredCv.needsReview) return structuredCv;
  const flatFallback = structureCv(sourceText);
  flatFallback.needsReview = true;
  if (env.LLM_PROVIDER === "disabled") return flatFallback;

  const consents = await getConsentStatus(ownerId.toHexString());
  if (!consents.find((consent) => consent.purpose === "external_model_processing")?.accepted) {
    return flatFallback;
  }

  try {
    const anonymizedText = await prepareResumeTextForAI(ownerId.toHexString(), sourceText);
    if (anonymizedText !== sourceText) return flatFallback;
    const result = await runAgent({
      ownerId,
      task: "resume_structure",
      promptVersion: "resume-structure-v1",
      input: {
        sourceText: anonymizedText,
        lineMetadata: lines?.map((line) => ({
          kind: line.kind ?? "paragraph",
          bold: line.bold ?? false,
          fontSize: line.fontSize ?? null,
          alignRight: line.alignRight ?? false,
        })) ?? null,
      },
      schema: structuredCvSchema,
      instructions: [
        "Structure the supplied CV without rewriting, correcting, omitting, or adding any source content.",
        "Copy every source paragraph exactly into section sourceHeadings or lines, preserving order.",
        "Use custom sections for headings not in the known section dictionary.",
        "Do not place the same source text in both a heading and a line.",
        "Return needsReview=true if the exact source cannot be represented losslessly.",
      ].join(" "),
      requiresResumeProcessingConsent: true,
    });
    const candidate = { ...result.value, header: flatFallback.header };
    if (
      result.value.needsReview ||
      !isStructuredCvLossless(sourceText, candidate) ||
      !hasOnlySourceDerivedFields(candidate)
    ) return flatFallback;
    const validated = reseedStructuredCvIds(candidate);
    validated.coverage = 1;
    validated.needsReview = false;
    return validated;
  } catch (error) {
    if (error instanceof UpstreamServiceError || error instanceof ServiceUnavailableError) return flatFallback;
    throw error;
  }
}

function sanitizeFileName(name: string): string {
  const baseName = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const safeName = baseName.replace(/[\u0000-\u001f\u007f]/g, "_").trim().slice(0, 255);
  return safeName || `resume${path.extname(name).toLowerCase()}`;
}

