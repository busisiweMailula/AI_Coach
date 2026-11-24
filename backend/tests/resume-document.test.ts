import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createResumeWordDocument } from "../../frontend/src/features/resume/resume-document.js";
import { parseResumeSections } from "../../frontend/src/features/resume/resume-format.js";
import { structureCv } from "../src/modules/resumes/structured-cv.js";

describe("createResumeWordDocument", () => {
  it("creates a structured editable Word CV with heading borders and real bullets", async () => {
    const cv = structureCv([
      "PROFESSIONAL SUMMARY",
      "Finance graduate with cash management experience.",
      "CORE COMPETENCIES",
      "Cash Management | Liquidity Forecasting",
      "TECHNICAL SKILLS",
      "Languages: TypeScript, Python",
      "PROFESSIONAL EXPERIENCE",
      "Treasury Analyst 2022 – Present Acme | Remote",
      "• Managed cash forecasts.",
      "REFERENCES",
      "Available on request.",
    ].join("\n"));
    cv.header.name = "Candidate";
    cv.header.email = "candidate@example.test";
    const document = await createResumeWordDocument(cv);

    expect(document.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(document.size).toBeGreaterThan(1000);
    const archive = await JSZip.loadAsync(await document.arrayBuffer());
    const xml = await archive.file("word/document.xml")?.async("string");
    const paragraphs = xml?.match(/<w:p(?:\s|>)[\s\S]*?<\/w:p>/g) ?? [];
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.filter((paragraph) => /<w:pBdr>/.test(paragraph))).toHaveLength(5);
    const headings = paragraphs.filter((paragraph) => /<w:pStyle w:val="Heading1"/.test(paragraph));
    expect(headings).toHaveLength(5);
    expect(xml).toContain("PROFESSIONAL SUMMARY");
    expect(xml).toContain("CORE COMPETENCIES");
    expect(xml).toContain("TECHNICAL SKILLS");
    expect(xml).toContain("PROFESSIONAL EXPERIENCE");
    expect(xml).toContain("REFERENCES");
    expect(xml).toContain("<w:numPr>");
    expect(xml).not.toContain("accepted");
    expect(xml).not.toContain("suggestion");
    expect(xml?.match(/PROFESSIONAL EXPERIENCE/g)).toHaveLength(1);
    const experienceHeading = headings.find((paragraph) => paragraph.includes("PROFESSIONAL EXPERIENCE"));
    expect(experienceHeading).not.toContain('w:val="Title"');
    const properties = await archive.file("docProps/core.xml")?.async("string");
    expect(properties).toContain("Careerkit");
    expect(properties).toContain("Resume draft");
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
