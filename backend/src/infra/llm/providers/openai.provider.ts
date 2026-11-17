import {
  LlmProviderError,
  type LlmCompletion,
  type LlmProvider,
  type LlmRequest,
} from "../llm-provider.js";

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly name: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly temperature = 0,
  ) {}

  async generateJson(request: LlmRequest): Promise<LlmCompletion> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          temperature: this.temperature,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
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

    const body = await readBody(response, this.name, request.model);
    if (!response.ok) {
      throw new LlmProviderError(
        "LLM provider rejected the request",
        `LLM_HTTP_${response.status}`,
        response.status === 410 || response.status === 429 || response.status >= 500,
        this.name,
        request.model,
      );
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
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

export class OpenAiProvider extends OpenAiCompatibleProvider {
  constructor(apiKey: string) {
    super("openai", apiKey, "https://api.openai.com/v1");
  }
}

async function readBody(
  response: Response,
  provider: string,
  model: string,
): Promise<OpenAiResponse> {
  try {
    return (await response.json()) as OpenAiResponse;
  } catch {
    throw new LlmProviderError(
      "LLM provider returned an invalid response",
      "LLM_INVALID_RESPONSE",
      true,
      provider,
      model,
    );
  }
}
