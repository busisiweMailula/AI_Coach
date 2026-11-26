import { ServiceUnavailableError, UpstreamServiceError } from "../../common/errors.js";
import { createPresidioResumeAnonymizer, hasValidPlaceholders } from "./presidio-anonymizer.js";
import { ensureResumeConsent } from "./privacy.service.js";

export interface ResumeAnonymizer {
  anonymize(resumeText: string): Promise<string>;
}

let resumeAnonymizer: ResumeAnonymizer | undefined = createPresidioResumeAnonymizer();

export function configureResumeAnonymizer(anonymizer: ResumeAnonymizer | undefined): void {
  resumeAnonymizer = anonymizer;
}

export async function prepareResumeTextForAI(ownerId: string, resumeText: string): Promise<string> {
  await ensureResumeConsent(ownerId);
  return anonymizeTextForAI(resumeText);
}

export async function anonymizeTextForAI(text: string): Promise<string> {
  if (!resumeAnonymizer) {
    throw new ServiceUnavailableError(
      "Text anonymization is not configured; content was not sent to an AI service",
    );
  }
  const anonymizedText = await resumeAnonymizer.anonymize(text);
  if (!anonymizedText.trim()) {
    throw new UpstreamServiceError("Text anonymization returned empty text; content was not sent to an AI service");
  }
  if (!hasValidPlaceholders(text, anonymizedText)) {
    throw new UpstreamServiceError("Text anonymization returned an unsupported placeholder; content was not sent to an AI service");
  }
  return anonymizedText;
}
