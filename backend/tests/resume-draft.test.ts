import { describe, expect, it } from "vitest";
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

  it("maps suggestions across short, unique anchors around anonymized text", () => {
    expect(buildResumeDraft("word Example Company next", "word <ORG> next", [{
      originalText: "<ORG>",
      proposedText: "Example Company",
    }])).toBe("word Example Company next");
  });

  it("maps anonymized suggestions when CV extraction uses different line breaks", () => {
    const source = "Highlights:\nBuilt a scalable system for Example Corp.\nResult: reduced latency";
    const anonymized = "Highlights: Built a scalable system for <ORG>. Result: reduced latency";

    expect(buildResumeDraft(source, anonymized, [{
      originalText: "Built a scalable system for <ORG>.",
      proposedText: "Built a scalable system supporting business operations.",
    }])).toBe("Highlights:\nBuilt a scalable system supporting business operations.\nResult: reduced latency");
  });

  it("includes accepted suggestions that cannot be mapped without altering ambiguous source text", () => {
    expect(buildResumeDraft("Built APIs. Built APIs.", "Built APIs. Built APIs.", [{
      originalText: "Built APIs.",
      proposedText: "Designed APIs.",
    }])).toBe("Built APIs. Built APIs.\n\nAccepted CV updates\n- Designed APIs.");
  });

  it("includes accepted suggestions when extracted and anonymized context cannot be aligned", () => {
    expect(buildResumeDraft(
      "CAREER INTERESTS\nDevelop practical AI engineering skills through hands-on technical projects.",
      "ANONYMIZED DETAILS <PERSON> hidden sentence. END DETAILS",
      [{
        originalText: "hidden sentence.",
        proposedText: "Develop practical AI engineering and software development skills.",
      }],
    )).toContain("Accepted CV updates\n- Develop practical AI engineering and software development skills.");
  });

  it("appends accepted changes whose ranges overlap instead of rejecting the whole draft", () => {
    expect(buildResumeDraft("Built reliable APIs for customers.", "Built reliable APIs for customers.", [
      { originalText: "Built reliable APIs", proposedText: "Designed reliable APIs" },
      { originalText: "reliable APIs for customers", proposedText: "reliable services for customers" },
    ])).toContain("Accepted CV updates\n- Designed reliable APIs\n- reliable services for customers");
  });
});
