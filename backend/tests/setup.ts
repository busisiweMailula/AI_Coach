process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-that-is-at-least-32-characters";
process.env.MONGODB_URI = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017";
process.env.MONGODB_DB_NAME = "ai_coach_test";
process.env.LLM_PROVIDER = "disabled";
process.env.EMBEDDING_PROVIDER = "disabled";

