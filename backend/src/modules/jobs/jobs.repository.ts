import { ObjectId } from "mongodb";
import { NotFoundError } from "../../common/errors.js";
import { logger } from "../../config/logger.js";
import { getDb } from "../../infra/db/database.js";
import type { AsyncJobDocument } from "../../infra/jobs/job.model.js";
import type { JobDescriptionDocument } from "./job-description.model.js";

const descriptions = () => getDb().collection<JobDescriptionDocument>("job_descriptions");
const jobs = () => getDb().collection<AsyncJobDocument>("jobs");

export async function insertJobDescription(
  description: JobDescriptionDocument,
  job: AsyncJobDocument,
): Promise<void> {
  await descriptions().insertOne(description);
  try {
    await jobs().insertOne(job);
  } catch (error) {
    try {
      await descriptions().deleteOne({ _id: description._id, ownerId: description.ownerId });
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, jobDescriptionId: description._id.toHexString() },
        "Failed to clean up job description after job persistence failure",
      );
    }
    throw error;
  }
}

export async function deleteJobDescription(
  id: ObjectId,
  ownerId: ObjectId,
): Promise<void> {
  await descriptions().deleteOne({ _id: id, ownerId });
}

export async function listJobDescriptions(ownerId: ObjectId): Promise<JobDescriptionDocument[]> {
  return descriptions().find({ ownerId }).sort({ createdAt: -1 }).limit(100).toArray();
}

export async function findJobDescription(
  id: string,
  ownerId: ObjectId,
): Promise<JobDescriptionDocument> {
  const description = await descriptions().findOne({ _id: parseObjectId(id), ownerId });
  if (!description) throw new NotFoundError("Job description not found");
  return description;
}

export async function findAsyncJob(
  id: string,
  ownerId: ObjectId,
): Promise<AsyncJobDocument> {
  const job = await jobs().findOne({ _id: parseObjectId(id), ownerId });
  if (!job) throw new NotFoundError("Job not found");
  return job;
}

function parseObjectId(value: string): ObjectId {
  if (!/^[\da-f]{24}$/i.test(value)) throw new NotFoundError();
  return new ObjectId(value);
}

