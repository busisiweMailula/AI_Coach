import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createResumeWordDocument } from "../src/modules/resumes/cv-word-export.js";
import { applyAnchoredSuggestion, structureCv } from "../src/modules/resumes/structured-cv.js";

describe("createResumeWordDocument", () => {
  it("exports the derived CV as an editable Word document with headings and numbered bullets", async () => {
    const cv = structureCv([
      "Thandiwe Mokoena",
      "AI / ML Engineer",
      "PROFESSIONAL SUMMARY",
      "Original summary wording.",
      "PROFESSIONAL EXPERIENCE",
      "Senior Engineer 2022 - Present Example Co.",
      "• Built secure APIs.",
      "CORE COMPETENCIES",
      "Cloud: AWS, Azure",
      "TECHNICAL SKILLS",
      "Languages: TypeScript, Python",
    ].join("\n"));
    const summary = cv.sections.find((section) => section.type === "summary")!;
    const updated = applyAnchoredSuggestion(cv, {
      sectionId: summary.id,
      field: "text",
      operation: "replace",
      proposedText: "Improved summary wording.",
      reason: "Clarifies the summary.",
      jobRequirement: "Role profile.",
    }, "summary-edit");
    expect(updated.applied).toBe(true);

    const buffer = await createResumeWordDocument(updated.cv);
    const archive = await JSZip.loadAsync(buffer);
    const xml = await archive.file("word/document.xml")?.async("string") ?? "";
    const styles = await archive.file("word/styles.xml")?.async("string") ?? "";
    expect(xml).toContain("Thandiwe Mokoena");
    expect(xml.match(/Improved summary wording\./g)).toHaveLength(1);
    expect(xml).not.toContain("Original summary wording.");
    expect(xml).toContain("PROFESSIONAL EXPERIENCE");
    expect(xml).toContain("CORE COMPETENCIES");
    expect(xml).toContain("TECHNICAL SKILLS");
    expect(xml).toContain("Senior Engineer");
    expect(xml).toContain("Built secure APIs.");
    expect(xml).toMatch(/<w:numPr>/);
    expect(xml.match(/<w:pStyle\b[^>]*w:val="Heading1"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(xml).toMatch(/<w:pBdr>[\s\S]*?<w:bottom\b/);
    expect(styles).toContain("Calibri");
  });
});
