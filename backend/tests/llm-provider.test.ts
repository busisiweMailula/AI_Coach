import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmProviderError, type LlmProvider, type LlmRequest } from "../src/infra/llm/llm-provider.js";
import { FallbackLlmProvider } from "../src/infra/llm/providers/fallback.provider.js";
import { OpenAiCompatibleProvider } from "../src/infra/llm/providers/openai.provider.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible LLM providers", () => {
  it("calls the configured Inception endpoint and reports the model used", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider(
      "inception",
      "inception-test-key",
      "https://api.inceptionlabs.ai/v1/",
      0.5,
    );

    const completion = await provider.generateJson(request("mercury-3"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.inceptionlabs.ai/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining('"model":"mercury-3"'),
      }),
    );
    expect(completion).toEqual({
      content: "{\"ok\":true}",
      provider: "inception",
      model: "mercury-3",
    });
  });
});

describe("LLM fallback provider", () => {
  it("uses Groq after a retryable Inception error and reports the fallback model", async () => {
    const inception = new FakeProvider(
      "inception",
      new LlmProviderError("Rate limited", "LLM_HTTP_429", true, "inception", "mercury-3"),
    );
    const groq = new FakeProvider("groq", "groq response");
    const provider = new FallbackLlmProvider(inception, groq, "openai/gpt-oss-120b");

    const completion = await provider.generateJson(request("mercury-3"));

    expect(inception.requests[0].model).toBe("mercury-3");
    expect(groq.requests[0].model).toBe("openai/gpt-oss-120b");
    expect(completion).toEqual({
      content: "groq response",
      provider: "groq",
      model: "openai/gpt-oss-120b",
    });
  });

  it("uses Groq when the Inception API has been retired", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Service retired" },
    }), {
      status: 410,
      headers: { "Content-Type": "application/json" },
    })));
    const inception = new OpenAiCompatibleProvider(
      "inception",
      "inception-test-key",
      "https://api.inceptionlabs.ai/v1",
      0.5,
    );
    const groq = new FakeProvider("groq", "groq response");
    const provider = new FallbackLlmProvider(inception, groq, "openai/gpt-oss-120b");

    const completion = await provider.generateJson(request("mercury-3"));

    expect(completion.provider).toBe("groq");
    expect(completion.model).toBe("openai/gpt-oss-120b");
  });

  it("does not hide non-retryable Inception configuration errors", async () => {
    const inception = new FakeProvider(
      "inception",
      new LlmProviderError("Invalid API key", "LLM_HTTP_401", false, "inception", "mercury-3"),
    );
    const groq = new FakeProvider("groq", "groq response");
    const provider = new FallbackLlmProvider(inception, groq, "openai/gpt-oss-120b");

    await expect(provider.generateJson(request("mercury-3"))).rejects.toThrow("Invalid API key");
    expect(groq.requests).toHaveLength(0);
  });
});

class FakeProvider implements LlmProvider {
  readonly requests: LlmRequest[] = [];

  constructor(
    readonly name: string,
    private readonly result: string | Error,
  ) {}

  async generateJson(input: LlmRequest) {
    this.requests.push(input);
    if (this.result instanceof Error) throw this.result;
    return { content: this.result, provider: this.name, model: input.model };
  }
}

function request(model: string): LlmRequest {
  return {
    task: "resume_parser",
    model,
    systemPrompt: "Return JSON",
    userPrompt: "{}",
    timeoutMs: 1000,
  };
}
