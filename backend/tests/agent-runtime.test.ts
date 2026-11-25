import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { ResumeParseSchema } from "../src/agents/schemas.js";

const mocks = vi.hoisted(() => ({
  generateJson: vi.fn(),
  insertOne: vi.fn(),
  ensureExternalModelConsent: vi.fn(),
  ensureResumeConsent: vi.fn(),
  sanitizeForLlm: vi.fn(async (text: string) => text.replaceAll("private@example.com", "<EMAIL_ADDRESS>")),
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
  sanitizeForLlm: mocks.sanitizeForLlm,
}));

import { runAgent } from "../src/agents/runtime/run-agent.js";

describe("agent runtime output contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("sanitizes agent input before calling the external provider", async () => {
    await runAgent({
      ownerId: new ObjectId(),
      task: "resume_parser",
      promptVersion: "resume-parser-v1",
      input: { resumeText: "Contact private@example.com" },
      schema: ResumeParseSchema,
    });

    const request = mocks.generateJson.mock.calls[0]?.[0] as { userPrompt: string };
    expect(mocks.sanitizeForLlm).toHaveBeenCalledWith(
      JSON.stringify({ resumeText: "Contact private@example.com" }),
    );
    expect(request.userPrompt).toContain("<EMAIL_ADDRESS>");
    expect(request.userPrompt).not.toContain("private@example.com");
  });

  it("does not call the external provider when Presidio fails", async () => {
    mocks.sanitizeForLlm.mockRejectedValueOnce(new Error("Presidio unavailable"));

    await expect(runAgent({
      ownerId: new ObjectId(),
      task: "resume_parser",
      promptVersion: "resume-parser-v1",
      input: { resumeText: "Contact private@example.com" },
      schema: ResumeParseSchema,
    })).rejects.toThrow("Presidio unavailable");

    expect(mocks.generateJson).not.toHaveBeenCalled();
  });
});
