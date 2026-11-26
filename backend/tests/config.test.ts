import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

describe("environment configuration", () => {
  it("requires a configured MongoDB URI and parses numeric settings", () => {
    const config = loadEnv({
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net",
      POSTGRES_URL: "postgresql://user:pass@postgres.example.net:5432/ai_coach",
      PORT: "4100",
      RATE_LIMIT_MAX_REQUESTS: "25",
      EMBEDDING_PROVIDER: "disabled",
    });

    expect(config.PORT).toBe(4100);
    expect(config.RATE_LIMIT_MAX_REQUESTS).toBe(25);
    expect(config.MONGODB_URI).toBe("mongodb+srv://user:pass@cluster.example.net");
    expect(config.MONGODB_DB_NAME).toBe("ai_coach");
    expect(config.PRESIDIO_URL).toBe("http://127.0.0.1:5002");
    expect(config.PRESIDIO_SPACY_MODEL).toBe("en_core_web_sm");
    expect(config.PRESIDIO_PERSON_CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  it("rejects localhost MongoDB outside test mode", () => {
    expect(() => loadEnv({
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      MONGODB_URI: "mongodb://127.0.0.1:27017",
    })).toThrow("MONGODB_URI must point to a remote MongoDB deployment");
  });

  it("requires PostgreSQL for audit storage outside test mode", () => {
    expect(() => loadEnv({
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net",
    })).toThrow("POSTGRES_URL is required for audit log storage");
  });

  it("rejects localhost PostgreSQL outside test mode", () => {
    expect(() => loadEnv({
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net",
      POSTGRES_URL: "postgresql://user:pass@localhost:5432/ai_coach",
    })).toThrow("POSTGRES_URL must point to a remote PostgreSQL deployment");
  });

  it("rejects a weak JWT secret", () => {
    expect(() => loadEnv({
      JWT_SECRET: "too-short",
      MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net",
      EMBEDDING_PROVIDER: "disabled",
    })).toThrow();
  });

  it("rejects a weak configured Presidio token and invalid person threshold", () => {
    const base = {
      NODE_ENV: "test",
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      MONGODB_URI: "mongodb://127.0.0.1:27017",
    };

    expect(() => loadEnv({ ...base, PRESIDIO_API_TOKEN: "short" })).toThrow();
    expect(() => loadEnv({ ...base, PRESIDIO_PERSON_CONFIDENCE_THRESHOLD: "1.1" })).toThrow();
    expect(loadEnv({ ...base, PRESIDIO_PERSON_CONFIDENCE_THRESHOLD: "0.8" })
      .PRESIDIO_PERSON_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  it("requires both Inception and Groq keys for the configured fallback", () => {
    const base = {
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net",
      POSTGRES_URL: "postgresql://user:pass@postgres.example.net:5432/ai_coach",
      LLM_PROVIDER: "inception",
      EMBEDDING_PROVIDER: "disabled",
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

  it("allows the API to start without optional Mistral credentials", () => {
    const base = {
      JWT_SECRET: "a-valid-test-secret-with-at-least-32-chars",
      MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net",
      POSTGRES_URL: "postgresql://user:pass@postgres.example.net:5432/ai_coach",
      EMBEDDING_PROVIDER: "mistral",
    };

    expect(loadEnv(base).EMBEDDING_PROVIDER).toBe("mistral");
    expect(loadEnv({ ...base, MISTRAL_API_KEY: "mistral-test-key" }).MISTRAL_EMBEDDING_MODEL)
      .toBe("mistral-embed");
  });
});

