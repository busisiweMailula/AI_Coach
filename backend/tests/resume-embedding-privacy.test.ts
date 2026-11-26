import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  anonymizeTextForAI: vi.fn(),
  ensureResumeConsent: vi.fn(),
  ensureExternalModelConsent: vi.fn(),
  bulkWrite: vi.fn(),
  deleteMany: vi.fn(),
  toArray: vi.fn(),
}));

vi.mock("../src/infra/embeddings/embedding-provider.js", () => ({
  getTextEmbedder: () => ({ embed: mocks.embed }),
}));

vi.mock("../src/modules/privacy/resume-anonymizer.js", () => ({
  anonymizeTextForAI: mocks.anonymizeTextForAI,
}));

vi.mock("../src/modules/privacy/privacy.service.js", () => ({
  ensureResumeConsent: mocks.ensureResumeConsent,
  ensureExternalModelConsent: mocks.ensureExternalModelConsent,
}));

vi.mock("../src/infra/db/database.js", () => ({
  getDb: () => ({
    collection: () => ({
      bulkWrite: mocks.bulkWrite,
      deleteMany: mocks.deleteMany,
      find: () => ({ toArray: mocks.toArray }),
    }),
  }),
}));

import { findRelevantResumeEvidence } from "../src/infra/embeddings/resume-semantic-search.js";

describe("resume embedding privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anonymizeTextForAI.mockImplementation(async (text: string) =>
      text.replace("Candidate Name", "<PERSON>").replace("Recruiter Name", "<PERSON>"),
    );
    mocks.embed.mockImplementation(async (texts: string[]) =>
      texts.map(() => [1, 0]),
    );
    mocks.bulkWrite.mockResolvedValue(undefined);
    mocks.deleteMany.mockResolvedValue(undefined);
    mocks.toArray.mockResolvedValue([]);
  });

  it("anonymizes every resume chunk and query before embedding", async () => {
    await findRelevantResumeEvidence({
      ownerId: new ObjectId(),
      resumeId: new ObjectId(),
      anonymizedResumeText: "Candidate Name used TypeScript at work",
      queryText: "Recruiter Name wants TypeScript",
    });

    expect(mocks.embed).toHaveBeenCalledWith([
      "<PERSON> used TypeScript at work",
      "<PERSON> wants TypeScript",
    ]);
    expect(JSON.stringify(mocks.embed.mock.calls[0])).not.toContain("Candidate Name");
    expect(JSON.stringify(mocks.embed.mock.calls[0])).not.toContain("Recruiter Name");
    expect(mocks.ensureResumeConsent).toHaveBeenCalledTimes(1);
    expect(mocks.ensureExternalModelConsent).toHaveBeenCalledTimes(1);
  });

  it("does not call the embedding provider if anonymization fails", async () => {
    mocks.anonymizeTextForAI.mockRejectedValue(new Error("safe anonymizer failure"));

    await expect(findRelevantResumeEvidence({
      ownerId: new ObjectId(),
      resumeId: new ObjectId(),
      anonymizedResumeText: "Candidate Name private data",
      queryText: "Recruiter Name private query",
    })).rejects.toThrow("safe anonymizer failure");

    expect(mocks.embed).not.toHaveBeenCalled();
  });
});
