import { z } from "zod";
import { ServiceUnavailableError, UpstreamServiceError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { ResumeAnonymizer } from "./resume-anonymizer.js";

const anonymizationResponseSchema = z.object({
  anonymizedText: z.string().min(1),
});

export interface PresidioAnonymizerOptions {
  serviceUrl?: string;
  timeoutMs?: number;
  apiToken?: string;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}

export function createPresidioResumeAnonymizer(
  options: PresidioAnonymizerOptions = {},
): ResumeAnonymizer {
  const serviceUrl = options.serviceUrl ?? env.PRESIDIO_URL;
  const timeoutMs = options.timeoutMs ?? env.PRESIDIO_TIMEOUT_MS;
  const apiToken = options.apiToken ?? env.PRESIDIO_API_TOKEN;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const endpoint = `${serviceUrl.replace(/\/+$/, "")}/anonymize`;

  return {
    async anonymize(resumeText: string): Promise<string> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ text: resumeText }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        logger.warn(
          { errorType: error instanceof Error ? error.name : "unknown" },
          "Presidio anonymization request failed",
        );
        throw new ServiceUnavailableError(
          "CV anonymization service is unavailable; CV content was not sent to an AI service",
        );
      }

      if (!response.ok) {
        logger.warn({ status: response.status }, "Presidio returned an unsuccessful response");
        throw new UpstreamServiceError(
          "CV anonymization failed; CV content was not sent to an AI service",
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        logger.warn(
          { errorType: error instanceof Error ? error.name : "unknown" },
          "Presidio returned invalid JSON",
        );
        throw new UpstreamServiceError(
          "CV anonymization failed; CV content was not sent to an AI service",
        );
      }

      const parsed = anonymizationResponseSchema.safeParse(payload);
      if (!parsed.success || !parsed.data.anonymizedText.trim()) {
        logger.warn("Presidio returned an invalid anonymization response");
        throw new UpstreamServiceError(
          "CV anonymization failed; CV content was not sent to an AI service",
        );
      }

      return parsed.data.anonymizedText;
    },
  };
}
