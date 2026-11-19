import { ServiceUnavailableError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { MistralEmbedder } from "./mistral-embedder.js";

export function getTextEmbedder(): MistralEmbedder {
  if (env.EMBEDDING_PROVIDER !== "mistral" || !env.MISTRAL_API_KEY) {
    throw new ServiceUnavailableError("Mistral embeddings are not configured");
  }
  return new MistralEmbedder(
    env.MISTRAL_API_KEY,
    env.MISTRAL_EMBEDDING_MODEL,
    env.EMBEDDING_TIMEOUT_MS,
  );
}
