import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { ResumeParseSchema } from "../src/agents/schemas.js";

const mocks = vi.hoisted(() => ({
  generateJson: vi.fn(),
  insertOne: vi.fn(),
  ensureExternalModelConsent: vi.fn(),
  ensureResumeConsent: vi.fn(),
  anonymizeTextForAI: vi.fn(),
}));

vi.mock("../src/infra/llm/provider-factory.js", () => ({
  getLlmProvider: () => ({ name: "test", generateJson: mocks.generateJson }),
}));

vi.mock("../src/infra/db/database.js", () => ({
  getDb: () => ({ collection: () => ({ insertOne: mocks.insertOne }) }),
}));

vi.mock("../src/modules/privacy/privacy.service.js", () => ({
  ensureExternalModelConsent: mocks.ensureExternalModelConsent,
  ensureResumeConsent: mocks.ensureResumeConsent,
}));

vi.mock("../src/modules/privacy/resume-anonymizer.js", () => ({
  anonymizeTextForAI: mocks.anonymizeTextForAI,
}));

import { runAgent } from "../src/agents/runtime/run-agent.js";

describe("agent runtime output contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anonymizeTextForAI.mockImplementation(async (text: string) =>
      text.replace("Synthetic Candidate", "<PERSON>"),
    );
    mocks.generateJson.mockResolvedValue({
      content: JSON.stringify({
        summary: "Experienced software engineer",
        skills: [],
        workHistory: [],
        education: [],
        uncertaintyFlags: [],
      }),
      provider: "test",
      model: "test-model",
    });
  });

  it("sends the task schema to the provider", async () => {
    await runAgent({
      ownerId: new ObjectId(),
      task: "resume_parser",
      promptVersion: "resume-parser-v1",
      input: { resumeText: "Synthetic resume text" },
      schema: ResumeParseSchema,
    });

    const request = mocks.generateJson.mock.calls[0]?.[0] as { systemPrompt: string };
    expect(request.systemPrompt).toContain("Required output JSON Schema");
    expect(request.systemPrompt).toContain('"summary"');
    expect(request.systemPrompt).toContain('"uncertaintyFlags"');
  });

  it("sends only anonymized serialized input to the external provider", async () => {
    await runAgent({
      ownerId: new ObjectId(),
      task: "resume_parser",
      promptVersion: "resume-parser-v1",
      input: { resumeText: "Synthetic Candidate is an engineer" },
      schema: ResumeParseSchema,
      requiresResumeProcessingConsent: true,
    });

    const request = mocks.generateJson.mock.calls[0]?.[0] as { userPrompt: string };
    expect(request.userPrompt).toContain("<PERSON> is an engineer");
    expect(request.userPrompt).not.toContain("Synthetic Candidate");
    expect(mocks.ensureExternalModelConsent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.anonymizeTextForAI.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.ensureResumeConsent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.anonymizeTextForAI.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not call an external provider if anonymization fails", async () => {
    mocks.anonymizeTextForAI.mockRejectedValue(new Error("safe anonymizer failure"));

    await expect(runAgent({
      ownerId: new ObjectId(),
      task: "resume_parser",
      promptVersion: "resume-parser-v1",
      input: { resumeText: "Synthetic Candidate is an engineer" },
      schema: ResumeParseSchema,
      requiresResumeProcessingConsent: true,
    })).rejects.toThrow("safe anonymizer failure");

    expect(mocks.generateJson).not.toHaveBeenCalled();
  });

  it("does not anonymize or call a provider without external-model consent", async () => {
    mocks.ensureExternalModelConsent.mockRejectedValue(new Error("consent required"));

    await expect(runAgent({
      ownerId: new ObjectId(),
      task: "resume_parser",
      promptVersion: "resume-parser-v1",
      input: { resumeText: "Synthetic Candidate is an engineer" },
      schema: ResumeParseSchema,
    })).rejects.toThrow("consent required");

    expect(mocks.anonymizeTextForAI).not.toHaveBeenCalled();
    expect(mocks.generateJson).not.toHaveBeenCalled();
  });
});
