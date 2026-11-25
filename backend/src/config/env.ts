import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: [".env", "../.env"] });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default("ai_coach"),
  POSTGRES_URL: z.string().url().optional(),
  LLM_PROVIDER: z.enum(["disabled", "openai", "anthropic", "inception", "groq", "mock"]).default("disabled"),
  LLM_MODEL: z.string().min(1).default("gpt-4o-mini"),
  EMBEDDING_PROVIDER: z.enum(["disabled", "mistral"]).default("mistral"),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_EMBEDDING_MODEL: z.string().min(1).default("mistral-embed"),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  INCEPTION_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  PRESIDIO_URL: z.string().url().default("http://127.0.0.1:5002"),
  PRESIDIO_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(60_000),
  PRESIDIO_API_TOKEN: z.string().min(32).optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(25 * 1024 * 1024).default(5 * 1024 * 1024),
  MAX_EXTRACTED_TEXT_CHARS: z.coerce.number().int().positive().max(1_000_000).default(200_000),
  MAX_PDF_PAGES: z.coerce.number().int().positive().max(500).default(100),
  MAX_DOCX_ENTRIES: z.coerce.number().int().positive().max(10_000).default(1_000),
  MAX_DOCX_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().max(100 * 1024 * 1024).default(20 * 1024 * 1024),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);
  if (parsed.NODE_ENV !== "test" && isLocalMongoUri(parsed.MONGODB_URI)) {
    throw new Error("MONGODB_URI must point to a remote MongoDB deployment outside tests");
  }
  if (parsed.NODE_ENV !== "test" && !parsed.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is required for audit log storage outside tests");
  }
  if (parsed.NODE_ENV !== "test" && parsed.POSTGRES_URL && isLocalPostgresUrl(parsed.POSTGRES_URL)) {
    throw new Error("POSTGRES_URL must point to a remote PostgreSQL deployment outside tests");
  }
  if (parsed.LLM_PROVIDER === "openai" && !parsed.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
  }
  if (parsed.LLM_PROVIDER === "anthropic" && !parsed.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
  }
  if (parsed.LLM_PROVIDER === "inception" && !parsed.INCEPTION_API_KEY) {
    throw new Error("INCEPTION_API_KEY is required when LLM_PROVIDER=inception");
  }
  if (parsed.LLM_PROVIDER === "inception" && !parsed.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is required when LLM_PROVIDER=inception");
  }
  if (parsed.LLM_PROVIDER === "groq" && !parsed.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is required when LLM_PROVIDER=groq");
  }
  if (parsed.LLM_PROVIDER === "mock" && parsed.NODE_ENV !== "test") {
    throw new Error("LLM_PROVIDER=mock is only allowed in test environments");
  }
  return parsed;
}

function isLocalMongoUri(uri: string): boolean {
  try {
    const hostname = new URL(uri).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isLocalPostgresUrl(uri: string): boolean {
  try {
    const hostname = new URL(uri).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export const env = loadEnv();

