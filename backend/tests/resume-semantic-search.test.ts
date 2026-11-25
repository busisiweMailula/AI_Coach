import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  bulkWrite: vi.fn(),
  deleteMany: vi.fn(),
  find: vi.fn(),
  ensureExternalModelConsent: vi.fn(),
  ensureResumeConsent: vi.fn(),
  sanitizeForLlm: vi.fn(async (text: string) => text.replaceAll("Jane Doe", "<PERSON>")),
  storedChunks: [] as Array<Record<string, unknown>>,
}));

vi.mock("../src/infra/db/database.js", () => ({
  getDb: () => ({
    collection: () => ({
      bulkWrite: mocks.bulkWrite,
      deleteMany: mocks.deleteMany,
      find: mocks.find,
    }),
  }),
}));

vi.mock("../src/infra/embeddings/embedding-provider.js", () => ({
  getTextEmbedder: () => ({ embed: mocks.embed }),
}));

vi.mock("../src/modules/privacy/privacy.service.js", () => ({
  ensureExternalModelConsent: mocks.ensureExternalModelConsent,
  ensureResumeConsent: mocks.ensureResumeConsent,
}));

vi.mock("../src/modules/privacy/resume-anonymizer.js", () => ({
  sanitizeForLlm: mocks.sanitizeForLlm,
}));

import { rebuildResumeVectorIndex } from "../src/infra/embeddings/resume-semantic-search.js";

describe("resume vector index privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storedChunks = [];
    mocks.embed.mockImplementation(async (texts: string[]) => texts.map(() => [1]));
    mocks.bulkWrite.mockImplementation(async (operations: Array<{ updateOne: { filter: Record<string, unknown>; update: { $set: Record<string, unknown> } } }>) => {
      mocks.storedChunks = operations.map(({ updateOne }) => ({
        ...updateOne.filter,
        ...updateOne.update.$set,
      }));
    });
    mocks.deleteMany.mockResolvedValue(undefined);
    mocks.find.mockImplementation(() => ({ toArray: async () => mocks.storedChunks }));
  });

  it("embeds PII-sanitized chunks but stores original text for retrieval evidence", async () => {
    const ownerId = new ObjectId();
    const resumeId = new ObjectId();
    const source = "Jane Doe built REST APIs and webhooks.";

    const index = await rebuildResumeVectorIndex({
      ownerId,
      resumeId,
      resumeText: source,
      queryText: "Jane Doe REST APIs",
    });

    expect(mocks.embed).toHaveBeenCalledWith([
      "<PERSON> built REST APIs and webhooks.",
      "<PERSON> REST APIs",
    ]);
    expect(index.chunks[0]?.content).toBe(source);
    expect(mocks.bulkWrite.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          update: expect.objectContaining({
            $set: expect.objectContaining({ content: source }),
          }),
        }),
      }),
    ]);
  });
});
