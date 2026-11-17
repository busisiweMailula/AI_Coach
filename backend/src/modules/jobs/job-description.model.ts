import type { ObjectId } from "mongodb";
import type { AsyncJobStatus } from "../../infra/jobs/job.model.js";

export interface JobDescriptionDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  sourceType: "paste" | "upload";
  sourceFileKey: string | null;
  rawText: string;
  normalizedText: string;
  analysisStatus: AsyncJobStatus;
  analysisJobId: ObjectId;
  roleTitle?: string | null;
  experienceRange?: { minYears: number | null; maxYears: number | null };
  requiredSkills?: Array<{ name: string; evidenceSnippet: string }>;
  preferredSkills?: Array<{ name: string; evidenceSnippet: string }>;
  responsibilities?: Array<{ text: string; evidenceSnippet: string }>;
  analyzerVersion?: string;
  agentExecutionIds?: ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

