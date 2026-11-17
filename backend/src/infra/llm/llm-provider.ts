export interface LlmRequest {
  task: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}

export interface LlmProvider {
  readonly name: string;
  generateJson(request: LlmRequest): Promise<LlmCompletion>;
}

export interface LlmCompletion {
  content: string;
  provider: string;
  model: string;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly provider?: string,
    public readonly model?: string,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
