import type { ObjectId } from "mongodb";

export const CONSENT_PURPOSES = [
  "resume_processing",
  "external_model_processing",
  "analytics",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentSource = "registration" | "upload" | "settings";

export const CONSENT_POLICY_VERSIONS: Record<ConsentPurpose, string> = {
  resume_processing: "resume-processing-v3",
  external_model_processing: "external-model-v2",
  analytics: "analytics-v1",
};

export interface ConsentDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  purpose: ConsentPurpose;
  policyVersion: string;
  granted: boolean;
  recordedAt: Date;
  revokedAt: Date | null;
  source: ConsentSource;
}

