import { describe, expect, it } from "vitest";
import { checkFabrication } from "../src/guardrails/fabrication.js";
import { evidenceExists } from "../src/guardrails/evidence.js";
import { findLanguageGuardrailHits, mentionsProtectedTraits } from "../src/guardrails/language.js";
import { calculateMatchScore } from "../src/guardrails/scoring.js";

describe("Phase 5 guardrails", () => {
  it("requires evidence snippets to exist in the source text", () => {
    expect(evidenceExists("Built REST APIs with TypeScript", "REST APIs")).toBe(true);
    expect(evidenceExists("Built REST APIs with TypeScript", "managed a team of 10")).toBe(false);
    expect(evidenceExists("Built REST-APIs for production.", "REST APIs")).toBe(true);
    expect(evidenceExists("Built REST APIs for production.", "REST  APIs")).toBe(true);
  });

  it("blocks numeric claims that do not appear in the source", () => {
    expect(checkFabrication("Improved latency by 90%", "Improved latency by 20%").safe).toBe(false);
    expect(checkFabrication("Improved latency by 20%", "Improved latency by 20%").safe).toBe(true);
  });

  it("flags hiring guarantees and protected-trait references", () => {
    expect(findLanguageGuardrailHits("This guarantees you will get the job")).not.toHaveLength(0);
    expect(mentionsProtectedTraits("Candidates should not be evaluated based on age")).toBe(true);
  });

  it("computes a deterministic score and excludes unknown components instead of treating them as zero", async () => {
    const fullScore = await calculateMatchScore({
      requiredSkillValues: [1],
      preferredSkillValues: null,
      responsibilityValues: null,
      experienceAlignment: null,
      evidenceQuality: 1,
    });
    expect(fullScore.score).toBe(100);
    expect(fullScore.breakdown).not.toHaveProperty("experienceAlignment");
    const partialScore = await calculateMatchScore({
      requiredSkillValues: [0.5],
      preferredSkillValues: null,
      responsibilityValues: null,
      experienceAlignment: null,
      evidenceQuality: 0.5,
    });
    expect(partialScore.score).toBe(50);
  });
});
