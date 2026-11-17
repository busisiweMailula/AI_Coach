import type { ObjectId } from "mongodb";

export type AsyncJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AsyncJobDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  type: string;
  status: AsyncJobStatus;
  progress: number;
  attempt: number;
  resultType: string | null;
  resultId: ObjectId | null;
  safeErrorCode: string | null;
  payload?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

