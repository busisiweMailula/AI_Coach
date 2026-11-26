import { z } from "zod";
import { ServiceUnavailableError, UpstreamServiceError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { ResumeAnonymizer } from "./resume-anonymizer.js";

const anonymizationResponseSchema = z.object({
  anonymizedText: z.string().min(1),
}).strict();
const PLACEHOLDER_PATTERN = /<[^<>]{1,256}>/g;
const SUPPORTED_PLACEHOLDERS = new Set([
  "<PERSON>",
  "<EMAIL_ADDRESS>",
  "<PHONE_NUMBER>",
  "<ZA_ID_NUMBER>",
]);
const MAX_ATTEMPTS = 3;

export interface PresidioAnonymizerOptions {
  serviceUrl?: string;
  timeoutMs?: number;
  apiToken?: string;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  randomImpl?: () => number;
}

export function createPresidioResumeAnonymizer(
  options: PresidioAnonymizerOptions = {},
): ResumeAnonymizer {
  const serviceUrl = options.serviceUrl ?? env.PRESIDIO_URL;
  const timeoutMs = options.timeoutMs ?? env.PRESIDIO_TIMEOUT_MS;
  const apiToken = options.apiToken ?? env.PRESIDIO_API_TOKEN;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleepImpl = options.sleepImpl ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const randomImpl = options.randomImpl ?? Math.random;
  const endpoint = `${serviceUrl.replace(/\/+$/, "")}/anonymize`;

  return {
    async anonymize(resumeText: string): Promise<string> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

      let response: Response | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ text: resumeText }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          logger.warn(
            { attempt, errorType: error instanceof Error ? error.name : "unknown" },
            "Presidio anonymization request failed",
          );
          if (!isTransientNetworkError(error)) {
            throw new ServiceUnavailableError(
              "CV anonymization request failed; verify the service connection. CV content was not sent to an AI service",
            );
          }
          if (attempt === MAX_ATTEMPTS) {
            throw new ServiceUnavailableError(
              "CV anonymization service is unavailable; verify the service connection and retry. CV content was not sent to an AI service",
            );
          }
          await sleepImpl(retryDelayMs(attempt, randomImpl));
          continue;
        }

        if (response.status === 429 || response.status >= 500) {
          logger.warn({ status: response.status, attempt }, "Presidio returned a transient error");
          if (attempt === MAX_ATTEMPTS) break;
          await response.body?.cancel().catch(() => undefined);
          await sleepImpl(retryDelayMs(attempt, randomImpl));
          continue;
        }
        break;
      }

      if (!response) {
        throw new ServiceUnavailableError(
          "CV anonymization service is unavailable; verify the service connection and retry. CV content was not sent to an AI service",
        );
      }
      if (!response.ok) {
        logger.warn({ status: response.status }, "Presidio returned an unsuccessful response");
        throw new UpstreamServiceError(
          "CV anonymization failed; check the service configuration and retry. CV content was not sent to an AI service",
        );
      }

      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        logger.warn("Presidio returned an unsupported content type");
        throw new UpstreamServiceError(
          "CV anonymization returned an invalid response; CV content was not sent to an AI service",
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

      if (!hasValidPlaceholders(resumeText, parsed.data.anonymizedText)) {
        logger.warn("Presidio returned an unsupported placeholder");
        throw new UpstreamServiceError(
          "CV anonymization returned an unsupported placeholder; CV content was not sent to an AI service",
        );
      }

      return parsed.data.anonymizedText;
    },
  };
}

function retryDelayMs(attempt: number, random: () => number): number {
  const exponentialCap = Math.min(1_000, 100 * 2 ** (attempt - 1));
  return Math.floor(exponentialCap / 2 + random() * exponentialCap / 2);
}

function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError");
}

export function hasValidPlaceholders(input: string, output: string): boolean {
  const existing = new Map<string, number>();
  for (const placeholder of input.match(PLACEHOLDER_PATTERN) ?? []) {
    existing.set(placeholder, (existing.get(placeholder) ?? 0) + 1);
  }
  const outputCounts = new Map<string, number>();
  for (const placeholder of output.match(PLACEHOLDER_PATTERN) ?? []) {
    outputCounts.set(placeholder, (outputCounts.get(placeholder) ?? 0) + 1);
    if (
      !SUPPORTED_PLACEHOLDERS.has(placeholder) &&
      (outputCounts.get(placeholder) ?? 0) > (existing.get(placeholder) ?? 0)
    ) {
      return false;
    }
  }
  return true;
}
