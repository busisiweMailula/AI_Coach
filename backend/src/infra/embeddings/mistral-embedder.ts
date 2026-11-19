import { z } from "zod";
import { UpstreamServiceError, ValidationError } from "../../common/errors.js";

export const MISTRAL_EMBEDDING_DIMENSIONS = 1024;
const EMBEDDINGS_URL = "https://api.mistral.ai/v1/embeddings";
const BATCH_SIZE = 32;

const responseSchema = z.object({
  data: z.array(z.object({
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number()),
  })),
});

export class MistralEmbedder {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.some((text) => !text.trim())) {
      throw new ValidationError("Embedding inputs must not be empty");
    }
    if (texts.length === 0) return [];

    const vectors = new Array<number[] | undefined>(texts.length);
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      let response: Response;
      try {
        response = await this.fetchImpl(EMBEDDINGS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: this.model, input: batch }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        throw new UpstreamServiceError("Mistral embedding request failed");
      }

      if (!response.ok) {
        throw new UpstreamServiceError(`Mistral embedding request failed with status ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new UpstreamServiceError("Mistral returned an invalid embedding response");
      }

      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.data.length !== batch.length) {
        throw new UpstreamServiceError("Mistral returned an invalid embedding response");
      }
      for (const item of parsed.data.data) {
        if (
          item.index >= batch.length ||
          vectors[start + item.index] !== undefined ||
          item.embedding.length !== MISTRAL_EMBEDDING_DIMENSIONS ||
          item.embedding.some((value) => !Number.isFinite(value))
        ) {
          throw new UpstreamServiceError("Mistral returned an invalid embedding vector");
        }
        vectors[start + item.index] = item.embedding;
      }
    }

    const completeVectors: number[][] = [];
    for (const vector of vectors) {
      if (!vector) throw new UpstreamServiceError("Mistral returned an incomplete embedding response");
      completeVectors.push(vector);
    }
    return completeVectors;
  }
}
