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

  it("matches extracted replacement characters to normalized model punctuation", () => {
    expect(buildResumeDraft(
      "SAMPLE CV \uFFFD FICTIONAL CANDIDATE",
      "SAMPLE CV \uFFFD FICTIONAL CANDIDATE",
      [{
        originalText: "SAMPLE CV \u2013 FICTIONAL CANDIDATE",
        proposedText: "Jane Candidate",
      }],
    )).toBe("Jane Candidate");
  });

  it("matches ampersand and the model's expanded conjunction without leaving the source text behind", () => {
    expect(buildResumeDraft("Treasury & Investment Operations", "Treasury & Investment Operations", [{
      originalText: "Treasury and Investment Operations",
      proposedText: "Treasury Operations",
    }])).toBe("Treasury Operations");
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

  it("maps a fully anonymized header using the text surrounding its redacted fields", () => {
    const source = "SAMPLE CV - FICTIONAL CANDIDATE Lindiwe Radebe Treasury and Investment Operations Analyst | Treasury and Investment Operations Stellenbosch, Western Cape | +27 00 000 0000 | lindiwe@example.com | linkedin.com/in/profile\nPROFESSIONAL SUMMARY Finance graduate.";
    const anonymized = "SAMPLE CV - FICTIONAL CANDIDATE <ORGANIZATION> and <ORGANIZATION> Analyst | <ORGANIZATION>, <LOCATION> | +27 00 000 0000 | <EMAIL_ADDRESS> | <URL>\nPROFESSIONAL SUMMARY Finance graduate.";
    const originalText = "<ORGANIZATION> and <ORGANIZATION> Analyst | <ORGANIZATION>, <LOCATION> | +27 00 000 0000 | <EMAIL_ADDRESS> | <URL>";

    expect(buildResumeDraft(source, anonymized, [{
      originalText,
      proposedText: "Treasury Operations Analyst | Stellenbosch, Western Cape | +27 00 000 0000 | lindiwe@example.com | LinkedIn profile",
    }])).toBe("SAMPLE CV - FICTIONAL CANDIDATE Treasury Operations Analyst | Stellenbosch, Western Cape | +27 00 000 0000 | lindiwe@example.com | LinkedIn profile\nPROFESSIONAL SUMMARY Finance graduate.");
  });

  it("keeps applying later suggestions when an earlier edit changes their surrounding context", () => {
    const source = "SAMPLE CV - FICTIONAL CANDIDATE Treasury Analyst\nSUMMARY Finance graduate.";
    const anonymized = "SAMPLE CV - FICTIONAL CANDIDATE <ORGANIZATION> Analyst\nSUMMARY Finance graduate.";

    expect(buildResumeDraft(source, anonymized, [
      {
        originalText: "SAMPLE CV - FICTIONAL CANDIDATE",
        proposedText: "Jane Candidate",
      },
      {
        originalText: "<ORGANIZATION> Analyst",
        proposedText: "Treasury Operations Analyst",
      },
    ])).toBe("Jane Candidate Treasury Operations Analyst\nSUMMARY Finance graduate.");
  });

  it("maps anonymized suggestions when CV extraction uses different line breaks", () => {
    const source = "Highlights:\nBuilt a scalable system for Example Corp.\nResult: reduced latency";
    const anonymized = "Highlights: Built a scalable system for <ORG>. Result: reduced latency";

    expect(buildResumeDraft(source, anonymized, [{
      originalText: "Built a scalable system for <ORG>.",
      proposedText: "Built a scalable system supporting business operations.",
    }])).toBe("Highlights:\nBuilt a scalable system supporting business operations.\nResult: reduced latency");
  });

  it("replaces repeated accepted targets in place instead of appending them as bullets", () => {
    expect(buildResumeDraft("Built APIs. Built APIs.", "Built APIs. Built APIs.", [
      { originalText: "Built APIs.", proposedText: "Designed APIs." },
      { originalText: "Built APIs.", proposedText: "Delivered APIs." },
    ])).toBe("Designed APIs. Delivered APIs.");
  });

  it("reports accepted suggestions that cannot be safely matched to the current CV", () => {
    expect(() => buildResumeDraft(
      "CAREER INTERESTS\nDevelop practical AI engineering skills through hands-on technical projects.",
      "ANONYMIZED DETAILS <PERSON> hidden sentence. END DETAILS",
      [{
        originalText: "hidden sentence.",
        proposedText: "Develop practical AI engineering and software development skills.",
      }],
    )).toThrow(ConflictError);
  });

  it("applies nested accepted suggestions in place without retaining the old text", () => {
    const source = "Work Eligibility: South African citizen; valid driver's licence (Code B) Availability: One month's notice Interests: trail running";
    const anonymized = "Work Eligibility: <NRP> citizen; valid driver's licence (Code B) Availability: <DATE_TIME>'s notice Interests: trail running";
    const outerOriginal = "Work Eligibility: <NRP> citizen; valid driver's licence (Code B) Availability: <DATE_TIME>'s notice";
    const innerOriginal = "Availability: <DATE_TIME>'s notice";

    expect(buildResumeDraft(source, anonymized, [
      {
        originalText: outerOriginal,
        proposedText: "Work Eligibility: [Nationality] citizen; valid driver's licence (Code B) Availability: [X] weeks' notice",
        sourceSnippet: outerOriginal,
      },
      {
        originalText: innerOriginal,
        proposedText: "Availability: [X weeks] notice",
        sourceSnippet: innerOriginal,
      },
    ])).toBe("Work Eligibility: [Nationality] citizen; valid driver's licence (Code B) Availability: [X weeks] notice Interests: trail running");
  });

  it("reports accepted suggestions that cannot be matched to the CV", () => {
    expect(() => buildResumeDraft("Built reliable APIs for customers.", "Built reliable APIs for customers.", [
      { originalText: "Unavailable source text", proposedText: "Updated wording" },
    ])).toThrow(ConflictError);
  });
});
