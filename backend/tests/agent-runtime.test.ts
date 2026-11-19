import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { ResumeParseSchema } from "../src/agents/schemas.js";

const mocks = vi.hoisted(() => ({
  generateJson: vi.fn(),
  insertOne: vi.fn(),
  ensureExternalModelConsent: vi.fn(),
  ensureResumeConsent: vi.fn(),
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
});
