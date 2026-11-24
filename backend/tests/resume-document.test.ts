import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createResumeWordDocument } from "../../frontend/src/features/resume/resume-document.js";
import { parseResumeSections } from "../../frontend/src/features/resume/resume-format.js";

describe("createResumeWordDocument", () => {
  it("formats inline CV sections with bottom borders in the editable Word document", async () => {
    const document = await createResumeWordDocument(
      "Jane Candidate | Treasury Analyst\nPROFESSIONAL SUMMARY Finance graduate with cash management experience. CORE COMPETENCIES Cash Management | Liquidity Forecasting",
    );

    expect(document.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(document.size).toBeGreaterThan(1000);
    const archive = await JSZip.loadAsync(await document.arrayBuffer());
    const xml = await archive.file("word/document.xml")?.async("string");
    expect(xml).toContain("PROFESSIONAL SUMMARY");
    expect(xml).toContain("CORE COMPETENCIES");
    expect(xml?.match(/<w:pBdr>/g)).toHaveLength(2);
  });

  it("splits flattened section headings into distinct CV sections", () => {
    const sections = parseResumeSections(
      "Jane Candidate | Treasury Analyst PROFESSIONAL SUMMARY Finance graduate. CORE COMPETENCIES Cash Management.",
    );

    expect(sections.map((section) => section.heading)).toEqual([
      null,
      "PROFESSIONAL SUMMARY",
      "CORE COMPETENCIES",
    ]);
    expect(sections[1].lines).toEqual(["Finance graduate."]);
    expect(sections[2].lines).toEqual(["Cash Management."]);
  });
});
