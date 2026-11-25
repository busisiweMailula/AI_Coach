import { ServiceUnavailableError, UpstreamServiceError } from "../../common/errors.js";
import { createPresidioResumeAnonymizer } from "./presidio-anonymizer.js";

export interface ResumeAnonymizer {
  anonymize(resumeText: string): Promise<string>;
}

let resumeAnonymizer: ResumeAnonymizer | undefined = createPresidioResumeAnonymizer();

export function configureResumeAnonymizer(anonymizer: ResumeAnonymizer | undefined): void {
  resumeAnonymizer = anonymizer;
}

export async function sanitizeForLlm(text: string): Promise<string> {
  if (!resumeAnonymizer) {
    throw new ServiceUnavailableError(
      "CV anonymization is not configured; text was not sent to an AI service",
    );
  }
  const anonymizedText = await resumeAnonymizer.anonymize(text);
  if (!anonymizedText.trim()) throw new UpstreamServiceError("CV anonymization returned empty text");
  return anonymizedText;
}
