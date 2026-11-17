import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

describe("environment configuration", () => {
  it("uses validated defaults and parses numeric settings", () => {
    const config = loadEnv({
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      PORT: "4100",
      RATE_LIMIT_MAX_REQUESTS: "25",
    });

    expect(config.PORT).toBe(4100);
    expect(config.RATE_LIMIT_MAX_REQUESTS).toBe(25);
    expect(config.MONGODB_DB_NAME).toBe("ai-coach");
    expect(config.PRESIDIO_URL).toBe("http://127.0.0.1:5002");
  });

  it("rejects a weak JWT secret", () => {
    expect(() => loadEnv({ JWT_SECRET: "too-short" })).toThrow();
  });

  it("requires both Inception and Groq keys for the configured fallback", () => {
    const base = {
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      LLM_PROVIDER: "inception",
    };

    expect(() => loadEnv(base)).toThrow("INCEPTION_API_KEY is required");
    expect(() => loadEnv({ ...base, INCEPTION_API_KEY: "inception-test-key" }))
      .toThrow("GROQ_API_KEY is required");
    expect(loadEnv({
      ...base,
      INCEPTION_API_KEY: "inception-test-key",
      GROQ_API_KEY: "groq-test-key",
    }).GROQ_MODEL).toBe("openai/gpt-oss-120b");
  });
});

