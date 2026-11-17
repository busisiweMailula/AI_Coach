import type { ObjectId } from "mongodb";

export interface AgentExecutionDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  task: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  status: "succeeded" | "failed";
  attempts: number;
  durationMs: number;
  safeErrorCode: string | null;
  createdAt: Date;
}

