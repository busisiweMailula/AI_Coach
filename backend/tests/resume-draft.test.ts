import { describe, expect, it } from "vitest";
import { ConflictError } from "../src/common/errors.js";
import { buildResumeDraft } from "../src/modules/resumes/resume-draft.js";

describe("buildResumeDraft", () => {
  it("applies accepted text while preserving source text anonymized for model suggestions", () => {
    const source = "Education: BCom Honours at Example University in research methods.\nExperience: Analyst.";
    const anonymized = "Education: BCom Honours at <ORGANIZATION> in research methods.\nExperience: Analyst.";

    expect(buildResumeDraft(source, anonymized, [{
      originalText: "BCom Honours at <ORGANIZATION> in research methods.",
      proposedText: "BCom Honours focused on research methods.",
    }])).toBe("Education: BCom Honours focused on research methods.\nExperience: Analyst.");
  });

  it("uses only the suggestions supplied by the accepted-only query", () => {
    const source = "Created secure APIs. Reviewed technical designs.";

    expect(buildResumeDraft(source, source, [{
      originalText: "Created secure APIs.",
      proposedText: "Designed and delivered secure APIs.",
    }])).toBe("Designed and delivered secure APIs. Reviewed technical designs.");
  });

  it("uses the original source location when the suggestion text is unchanged by anonymization", () => {
    expect(buildResumeDraft("a X b", "a X b", [{
      originalText: "X",
      proposedText: "Y",
    }])).toBe("a Y b");
  });

  it("rejects ambiguous suggestion matches rather than changing the wrong text", () => {
    expect(() => buildResumeDraft("Built APIs. Built APIs.", "Built APIs. Built APIs.", [{
      originalText: "Built APIs.",
      proposedText: "Designed APIs.",
    }])).toThrow(ConflictError);
  });
});
