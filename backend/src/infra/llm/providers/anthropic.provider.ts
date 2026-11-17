import {
  LlmProviderError,
  type LlmCompletion,
  type LlmProvider,
  type LlmRequest,
} from "../llm-provider.js";

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  constructor(private readonly apiKey: string) {}

  async generateJson(request: LlmRequest): Promise<LlmCompletion> {
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: 4096,
          temperature: 0,
          system: request.systemPrompt,
          messages: [{ role: "user", content: request.userPrompt }],
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      throw new LlmProviderError(
        error instanceof Error && error.name === "TimeoutError"
          ? "LLM request timed out"
          : "LLM provider request failed",
        error instanceof Error && error.name === "TimeoutError" ? "LLM_TIMEOUT" : "LLM_UNAVAILABLE",
        true,
        this.name,
        request.model,
      );
    }

    const body = await readBody(response, request.model);
    if (!response.ok) {
      throw new LlmProviderError(
        "LLM provider rejected the request",
        `LLM_HTTP_${response.status}`,
        response.status === 429 || response.status >= 500,
        this.name,
        request.model,
      );
    }
    const content = body.content?.find((item) => item.type === "text")?.text;
    if (!content) {
      throw new LlmProviderError(
        "LLM provider returned no JSON content",
        "LLM_INVALID_RESPONSE",
        true,
        this.name,
        request.model,
      );
    }
    return { content, provider: this.name, model: request.model };
  }
}

async function readBody(response: Response, model: string): Promise<AnthropicResponse> {
  try {
    return (await response.json()) as AnthropicResponse;
  } catch {
    throw new LlmProviderError(
      "LLM provider returned an invalid response",
      "LLM_INVALID_RESPONSE",
      true,
      "anthropic",
      model,
    );
  }
}
