import { describe, expect, it } from "vitest";
import {
  applyAcceptedSuggestions,
  deriveSuggestionTarget,
  structureCv,
  type StructuredCv,
} from "../src/modules/resumes/structured-cv.js";
import { createResumeWordDocument } from "../../frontend/src/features/resume/resume-document.js";
import JSZip from "jszip";

const source = [
  "PROFESSIONAL SUMMARY",
  "Original summary text.",
  "CORE COMPETENCIES",
  "Communication",
  "TECHNICAL SKILLS",
  "Languages: TypeScript, Python",
  "PROFESSIONAL EXPERIENCE",
  "Junior AI Engineer 2024 – Present Acme | Remote",
  "• Built safe automation tools.",
  "AI Engineering Intern 2023 – 2024 Acme | Remote",
  "• Tested model outputs.",
  "PROFESSIONAL EXPERIENCE (CONTINUED)",
  "Added a second page detail.",
].join("\n");

function fixture(): StructuredCv {
  return structureCv(source);
}

describe("structured CV", () => {
  it("preserves source words, merges continued sections, and removes continued labels", () => {
    const cv = fixture();
    expect(cv.needsReview).toBe(false);
    expect(cv.coverage).toBe(1);
    expect(cv.sections.filter((section) => section.type === "experience")).toHaveLength(1);
    expect(cv.sections.map((section) => section.heading)).not.toContain("PROFESSIONAL EXPERIENCE (CONTINUED)");
    expect(cv.sections.flatMap((section) => section.lines.map((line) => line.text)).join(" "))
      .toContain("Added a second page detail.");
  });

  it("recovers headings and bullet boundaries from flattened text", () => {
    const cv = structureCv(
      "PROFESSIONAL SUMMARY Original summary text. CORE COMPETENCIES Communication TECHNICAL SKILLS Languages: TypeScript, Python PROFESSIONAL EXPERIENCE Junior AI Engineer 2024 – Present Acme | Remote • Built safe tools. AI Engineering Intern 2023 – 2024 Acme | Remote • Tested reliability.",
    );
    expect(cv.needsReview).toBe(false);
    expect(cv.sections.map((section) => section.type)).toEqual([
      "summary",
      "coreCompetencies",
      "technicalSkills",
      "experience",
    ]);
    const experience = cv.sections.find((section) => section.type === "experience")!;
    expect(experience.lines.filter((line) => line.kind === "bullet").map((line) => line.text))
      .toEqual(["Built safe tools.", "Tested reliability."]);
    expect(experience.entries.map((entry) => entry.title))
      .toEqual(["Junior AI Engineer", "AI Engineering Intern"]);
  });

  it("replaces accepted summary and technical-skills content in place without touching core competencies", () => {
    const cv = fixture();
    const summary = cv.sections.find((section) => section.type === "summary")!;
    const technical = cv.sections.find((section) => section.type === "technicalSkills")!;
    const core = cv.sections.find((section) => section.type === "coreCompetencies")!;
    const result = applyAcceptedSuggestions(cv, [
      {
        id: "summary",
        originalText: "Original summary text.",
        proposedText: "Revised summary text.",
        status: "accepted",
      },
      {
        id: "technical",
        originalText: "Languages: TypeScript, Python",
        proposedText: "Languages: TypeScript, Python, SQL",
        status: "accepted",
      },
    ]);

    expect(result.appliedSuggestionIds).toEqual(["summary", "technical"]);
    expect(result.structuredCv.sections.find((section) => section.id === summary.id)?.lines[0].text)
      .toBe("Revised summary text.");
    expect(result.structuredCv.sections.find((section) => section.id === technical.id)?.lines[0].text)
      .toBe("Languages: TypeScript, Python, SQL");
    expect(result.structuredCv.sections.find((section) => section.id === core.id)?.lines[0].text)
      .toBe("Communication");
    expect(JSON.stringify(result.structuredCv)).not.toContain("Original summary text.");
    expect(JSON.stringify(result.structuredCv).match(/Revised summary text/g)).toHaveLength(1);
  });

  it("targets a bullet to its role and leaves other roles unchanged", () => {
    const cv = fixture();
    const target = deriveSuggestionTarget(cv, {
      originalText: "Built safe automation tools.",
      proposedText: "Built reliable automation tools.",
    });
    expect(target?.sectionType).toBe("experience");
    expect(target?.bulletId).toBeDefined();
    const result = applyAcceptedSuggestions(cv, [{
      id: "junior-bullet",
      originalText: "Built safe automation tools.",
      proposedText: "Built reliable automation tools.",
      status: "accepted",
      target,
    }]);
    const experience = result.structuredCv.sections.find((section) => section.type === "experience")!;
    expect(experience.lines.find((line) => line.text === "Built reliable automation tools.")).toBeDefined();
    expect(experience.lines.find((line) => line.text === "Tested model outputs.")).toBeDefined();
    expect(experience.entries.find((entry) => entry.title === "Junior AI Engineer")?.bullets
      .map((line) => line.text)).toContain("Built reliable automation tools.");
    expect(experience.entries.find((entry) => entry.title === "AI Engineering Intern")?.bullets
      .map((line) => line.text)).toEqual(["Tested model outputs."]);
  });

  it("does not apply pending or rejected suggestions and reports ambiguous suggestions for placement", () => {
    const cv = structureCv("TECHNICAL SKILLS\nPython\nPython");
    const before = structuredClone(cv);
    const result = applyAcceptedSuggestions(cv, [
      { id: "rejected", originalText: "Python", proposedText: "Python, SQL", status: "rejected" },
      { id: "pending", originalText: "Python", proposedText: "Python, SQL", status: "pending" },
      { id: "ambiguous", originalText: "Python", proposedText: "Python, SQL", status: "accepted" },
    ]);
    expect(result.appliedSuggestionIds).toEqual([]);
    expect(result.needsPlacement.map((item) => item.suggestionId)).toEqual(["ambiguous"]);
    expect(result.structuredCv).toEqual(before);
  });

  it("produces identical structured content and Word document XML on repeated generation", async () => {
    const cv = fixture();
    const first = await createResumeWordDocument(cv);
    const second = await createResumeWordDocument(cv);
    const firstZip = await JSZip.loadAsync(await first.arrayBuffer());
    const secondZip = await JSZip.loadAsync(await second.arrayBuffer());
    expect(await firstZip.file("word/document.xml")?.async("string"))
      .toBe(await secondZip.file("word/document.xml")?.async("string"));
  });
});
