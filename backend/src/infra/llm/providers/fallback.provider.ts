import { LlmProviderError, type LlmCompletion, type LlmProvider, type LlmRequest } from "../llm-provider.js";
import { logger } from "../../../config/logger.js";

export class FallbackLlmProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly primary: LlmProvider,
    private readonly fallback: LlmProvider,
    private readonly fallbackModel: string,
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  async generateJson(request: LlmRequest): Promise<LlmCompletion> {
    try {
      return await this.primary.generateJson(request);
    } catch (error) {
      if (!(error instanceof LlmProviderError) || !error.retryable) throw error;
      logger.warn(
        {
          primaryProvider: this.primary.name,
          fallbackProvider: this.fallback.name,
          primaryModel: error.model ?? request.model,
          errorCode: error.code,
        },
        "Primary LLM provider failed; using fallback",
      );
      return this.fallback.generateJson({ ...request, model: this.fallbackModel });
    }
  }
}
