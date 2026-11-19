import { ObjectId } from "mongodb";
import { ForbiddenError } from "../../common/errors.js";
import { getDb } from "../../infra/db/database.js";
import {
  CONSENT_POLICY_VERSIONS,
  CONSENT_PURPOSES,
  type ConsentDocument,
  type ConsentPurpose,
  type ConsentSource,
} from "./consent.model.js";

const collectionName = "consents";

export async function listConsents(ownerId: string): Promise<ConsentDocument[]> {
  return getDb()
    .collection<ConsentDocument>(collectionName)
    .find({ ownerId: new ObjectId(ownerId) })
    .sort({ recordedAt: -1 })
    .limit(100)
    .toArray();
}

export async function getConsentStatus(ownerId: string) {
  const consents = getDb().collection<ConsentDocument>(collectionName);
  return Promise.all(CONSENT_PURPOSES.map(async (purpose) => {
    const latest = await consents
      .find({ ownerId: new ObjectId(ownerId), purpose })
      .sort({ recordedAt: -1, _id: -1 })
      .limit(1)
      .next();
    return {
      purpose,
      policyVersion: CONSENT_POLICY_VERSIONS[purpose],
      accepted: latest?.policyVersion === CONSENT_POLICY_VERSIONS[purpose] &&
        latest.granted &&
        latest.revokedAt === null,
    };
  }));
}

export async function recordConsent(input: {
  ownerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
}): Promise<ConsentDocument> {
  const recordedAt = new Date();
  const consent: ConsentDocument = {
    _id: new ObjectId(),
    ownerId: new ObjectId(input.ownerId),
    purpose: input.purpose,
    policyVersion: CONSENT_POLICY_VERSIONS[input.purpose],
    granted: input.granted,
    recordedAt,
    revokedAt: input.granted ? null : recordedAt,
    source: input.source,
  };
  await getDb().collection<ConsentDocument>(collectionName).insertOne(consent);
  return consent;
}

export async function ensureResumeConsent(
  ownerId: string,
): Promise<void> {
  const latest = await getDb()
    .collection<ConsentDocument>(collectionName)
    .find({ ownerId: new ObjectId(ownerId), purpose: "resume_processing" })
    .sort({ recordedAt: -1, _id: -1 })
    .limit(1)
    .next();
  if (
    !latest ||
    latest.policyVersion !== CONSENT_POLICY_VERSIONS.resume_processing ||
    !latest.granted ||
    latest.revokedAt !== null
  ) {
    throw new ForbiddenError("Consent to resume processing is required before upload");
  }
}

export async function ensureExternalModelConsent(ownerId: string | ObjectId): Promise<void> {
  const ownerObjectId = typeof ownerId === "string" ? new ObjectId(ownerId) : ownerId;
  const latest = await getDb()
    .collection<ConsentDocument>(collectionName)
    .find({ ownerId: ownerObjectId, purpose: "external_model_processing" })
    .sort({ recordedAt: -1, _id: -1 })
    .limit(1)
    .next();
  if (
    !latest ||
    latest.policyVersion !== CONSENT_POLICY_VERSIONS.external_model_processing ||
    !latest.granted ||
    latest.revokedAt !== null
  ) {
    throw new ForbiddenError("Consent to external AI processing is required");
  }
}
