import { ObjectId } from "mongodb";
import { env } from "../../config/env.js";
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
  anonymizedResumeText: string;
  queryText: string;
}): Promise<RelevantResumeEvidence[]> {
  const chunks = splitResumeText(input.anonymizedResumeText);
  if (chunks.length === 0) return [];

  const embedder = getTextEmbedder();
  const queryText = input.queryText.trim().slice(0, MAX_QUERY_CHARS);
  const vectors = await embedder.embed([...chunks, ...(queryText ? [queryText] : [])]);
  const resumeVectors = vectors.slice(0, chunks.length);
  const queryVector = queryText ? vectors[chunks.length] : resumeVectors[0];
  if (!queryVector) return [];

  const collection = getDb().collection<ResumeVectorDocument>("resume_vector_chunks");
  const now = new Date();
  await collection.bulkWrite(chunks.map((content, chunkIndex) => ({
    updateOne: {
      filter: { ownerId: input.ownerId, resumeId: input.resumeId, chunkIndex },
      update: {
        $set: {
          content,
          embedding: resumeVectors[chunkIndex],
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
  return rankResumeEvidence(storedChunks, queryVector, MAX_EVIDENCE_CHUNKS);
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
