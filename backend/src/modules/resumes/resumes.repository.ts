import { ObjectId } from "mongodb";
import { NotFoundError } from "../../common/errors.js";
import { getDb } from "../../infra/db/mongo.js";
import type { ResumeDocument, ResumeMetadataUpdate } from "./resume.model.js";

const collectionName = "resumes";

export async function insertResume(resume: ResumeDocument): Promise<void> {
  await getDb().collection<ResumeDocument>(collectionName).insertOne(resume);
}

export async function deleteResume(resumeId: ObjectId, ownerId: ObjectId): Promise<void> {
  await getDb().collection<ResumeDocument>(collectionName).deleteOne({ _id: resumeId, ownerId });
}

export async function findParsedResumeData(
  parsedId: ObjectId,
  ownerId: ObjectId,
) {
  return getDb().collection("parsed_resume_data").findOne({ _id: parsedId, ownerId });
}

export async function listResumes(ownerId: ObjectId): Promise<ResumeDocument[]> {
  return getDb()
    .collection<ResumeDocument>(collectionName)
    .find({ ownerId })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
}

export async function findResume(
  resumeId: string,
  ownerId: ObjectId,
): Promise<ResumeDocument> {
  const resume = await getDb()
    .collection<ResumeDocument>(collectionName)
    .findOne({ _id: parseObjectId(resumeId), ownerId });
  if (!resume) throw new NotFoundError("Resume not found");
  return resume;
}

export async function updateResume(
  resumeId: string,
  ownerId: ObjectId,
  update: ResumeMetadataUpdate,
): Promise<ResumeDocument> {
  const id = parseObjectId(resumeId);
  const result = await getDb().collection<ResumeDocument>(collectionName).updateOne(
    { _id: id, ownerId },
    { $set: { ...update, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) throw new NotFoundError("Resume not found");
  const updated = await getDb().collection<ResumeDocument>(collectionName).findOne({ _id: id, ownerId });
  if (!updated) throw new NotFoundError("Resume not found");
  return updated;
}

function parseObjectId(value: string): ObjectId {
  if (!/^[\da-f]{24}$/i.test(value)) throw new NotFoundError("Resume not found");
  return new ObjectId(value);
}

