import { ObjectId } from "mongodb";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../db/database.js";
import type { AsyncJobDocument } from "./job.model.js";
import { processAgentJob } from "./agent-job-processor.js";

const activeJobs = new Set<string>();

export async function enqueueAgentJob(input: {
  ownerId: string | ObjectId;
  type: string;
  resultType: string;
  payload: Record<string, string>;
}): Promise<AsyncJobDocument> {
  const ownerId = typeof input.ownerId === "string" ? new ObjectId(input.ownerId) : input.ownerId;
  const now = new Date();
  const job: AsyncJobDocument = {
    _id: new ObjectId(),
    ownerId,
    type: input.type,
    status: "queued",
    progress: 0,
    attempt: 0,
    resultType: input.resultType,
    resultId: new ObjectId(),
    safeErrorCode: null,
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().collection<AsyncJobDocument>("jobs").insertOne(job);
  scheduleAgentJob(job._id);
  return job;
}

export function scheduleAgentJob(id: ObjectId): void {
  if (env.LLM_PROVIDER === "disabled") return;
  const key = id.toHexString();
  if (activeJobs.has(key)) return;
  activeJobs.add(key);
  setImmediate(() => {
    void processAgentJob(id)
      .catch((error: unknown) => {
        logger.error({ err: error, jobId: key }, "Agent job processor crashed");
      })
      .finally(() => activeJobs.delete(key));
  });
}

export async function resumeQueuedAgentJobs(): Promise<void> {
  const collection = getDb().collection<AsyncJobDocument>("jobs");
  await collection.updateMany(
    { status: "running" },
    { $set: { status: "failed", safeErrorCode: "WORKER_INTERRUPTED", updatedAt: new Date() } },
  );
  if (env.LLM_PROVIDER === "disabled") return;
  const pending = await collection.find({ status: "queued" }).sort({ createdAt: 1 }).limit(100).toArray();
  pending.forEach((job) => scheduleAgentJob(job._id));
}
