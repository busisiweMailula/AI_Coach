import { ServiceUnavailableError, UpstreamServiceError } from "../../common/errors.js";
import { ensureResumeConsent } from "./privacy.service.js";

export interface ResumeAnonymizer {
  anonymize(resumeText: string): Promise<string>;
}

let resumeAnonymizer: ResumeAnonymizer | undefined;

export function configureResumeAnonymizer(anonymizer: ResumeAnonymizer | undefined): void {
  resumeAnonymizer = anonymizer;
}

export async function prepareResumeTextForAI(ownerId: string, resumeText: string): Promise<string> {
  await ensureResumeConsent(ownerId);
  if (!resumeAnonymizer) {
    throw new ServiceUnavailableError(
      "CV anonymization is not configured; CV content was not sent to an AI service",
    );
  }
  const anonymizedText = await resumeAnonymizer.anonymize(resumeText);
  if (!anonymizedText.trim()) throw new UpstreamServiceError("CV anonymization returned empty text");
  return anonymizedText;
}
