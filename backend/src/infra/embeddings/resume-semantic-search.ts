import { ObjectId } from "mongodb";
import { env } from "../../config/env.js";
import { ensureExternalModelConsent, ensureResumeConsent } from "../../modules/privacy/privacy.service.js";
import { sanitizeForLlm } from "../../modules/privacy/resume-anonymizer.js";
import { getDb } from "../db/database.js";
import { getTextEmbedder } from "./embedding-provider.js";

const MAX_CHUNK_CHARS = 1_200;
const MAX_QUERY_CHARS = 6_000;
const MAX_EVIDENCE_CHUNKS = 5;

interface ResumeVectorDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  resumeId: ObjectId;
  chunkIndex: number;
  content: string;
  embedding: number[];
  embeddingModel: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelevantResumeEvidence {
  content: string;
  score: number;
}

export async function findRelevantResumeEvidence(input: {
  ownerId: ObjectId;
  resumeId: ObjectId;
  resumeText: string;
  queryText: string;
}): Promise<RelevantResumeEvidence[]> {
  const index = await rebuildResumeVectorIndex({ ...input, queryText: input.queryText });
  if (!index.queryVector) return [];
  return rankResumeEvidence(index.chunks, index.queryVector, MAX_EVIDENCE_CHUNKS);
}

export async function rebuildResumeVectorIndex(input: {
  ownerId: ObjectId;
  resumeId: ObjectId;
  resumeText: string;
  queryText?: string;
}): Promise<{ chunks: ResumeVectorDocument[]; queryVector?: number[] }> {
  await ensureResumeConsent(input.ownerId.toHexString());
  await ensureExternalModelConsent(input.ownerId);

  const chunks = splitResumeText(input.resumeText);
  const queryText = input.queryText?.trim().slice(0, MAX_QUERY_CHARS) ?? "";
  const collection = getDb().collection<ResumeVectorDocument>("resume_vector_chunks");
  if (chunks.length === 0) {
    await collection.deleteMany({ ownerId: input.ownerId, resumeId: input.resumeId });
    return { chunks: [] };
  }

  const sanitizedInputs: string[] = [];
  for (const chunk of chunks) sanitizedInputs.push(await sanitizeForLlm(chunk));
  if (queryText) sanitizedInputs.push(await sanitizeForLlm(queryText));
  const vectors = await getTextEmbedder().embed(sanitizedInputs);
  const resumeVectors = vectors.slice(0, chunks.length);
  const queryVector = queryText ? vectors[chunks.length] : resumeVectors[0];
  const now = new Date();
  await collection.bulkWrite(chunks.map((content, chunkIndex) => ({
    updateOne: {
      filter: { ownerId: input.ownerId, resumeId: input.resumeId, chunkIndex },
      update: {
        $set: {
          content,
          embedding: resumeVectors[chunkIndex] ?? [],
          embeddingModel: env.MISTRAL_EMBEDDING_MODEL,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      upsert: true,
    },
  })));
  await collection.deleteMany({
    ownerId: input.ownerId,
    resumeId: input.resumeId,
    chunkIndex: { $gte: chunks.length },
  });

  const storedChunks = await collection.find({ ownerId: input.ownerId, resumeId: input.resumeId }).toArray();
  return { chunks: storedChunks, ...(queryVector ? { queryVector } : {}) };
}

export function splitResumeText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + MAX_CHUNK_CHARS / 2) end = boundary;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
    while (start < text.length && /\s/.test(text[start] ?? "")) start += 1;
  }
  return chunks;
}

export function rankResumeEvidence(
  chunks: Pick<ResumeVectorDocument, "content" | "embedding">[],
  queryVector: number[],
  limit: number,
): RelevantResumeEvidence[] {
  return chunks.map((chunk) => ({
    content: chunk.content,
    score: cosineSimilarity(chunk.embedding, queryVector),
  }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) return 0;
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return Math.max(0, dotProduct / Math.sqrt(leftMagnitude * rightMagnitude));
}
