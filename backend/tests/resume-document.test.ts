import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createResumeWordDocument } from "../../frontend/src/features/resume/resume-document.js";
import type { StructuredCv } from "../../frontend/src/api/client.js";

const cv: StructuredCv = {
  header: {
    name: "Candidate Name",
    headline: "Software Engineer",
    phone: "",
    email: "candidate@example.test",
    location: "",
    links: [],
    sourceLines: [],
  },
  sections: [
    {
      id: "summary",
      type: "summary",
      heading: "PROFESSIONAL SUMMARY",
      paragraphs: [{ id: "summary-line", kind: "paragraph", text: "Builds reliable software." }],
      groups: [],
      entries: [],
    },
    {
      id: "experience",
      type: "experience",
      heading: "PROFESSIONAL EXPERIENCE",
      paragraphs: [{ id: "bullet", kind: "bullet", text: "Improved a test workflow." }],
      groups: [],
      entries: [{
        id: "role",
        title: "Junior Engineer",
        company: "Example Company",
        location: "Remote",
        dates: "2024 – Present",
        lines: [{ id: "bullet", kind: "bullet", text: "Improved a test workflow." }],
      }],
    },
  ],
  lossless: { coverage: 1, verified: true },
};

describe("createResumeWordDocument", () => {
  it("writes editable structured sections, real headings, borders and list numbering", async () => {
    const blob = await createResumeWordDocument(cv);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toBeDefined();
    const xml = documentXml ?? "";
    const paragraphCount = [...xml.matchAll(/<w:p(?:\s|>)/g)].length;
    expect(paragraphCount).toBeGreaterThan(1);
    const sectionHeadingParagraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
      .filter((match) => /w:val="Heading1"/.test(match[0]));
    expect(sectionHeadingParagraphs).toHaveLength(2);
    expect(sectionHeadingParagraphs.every((match) => /<w:pBdr>[\s\S]*?<w:bottom\b/.test(match[0]))).toBe(true);
    expect(xml).toMatch(/<w:numPr>/);
    expect(xml.match(/<w:pStyle\b[^>]*w:val="Title"/g)).toHaveLength(1);
    expect(xml).not.toMatch(/suggestion|accepted/i);
    expect(xml.match(/PROFESSIONAL EXPERIENCE/g)).toHaveLength(1);
    const coreXml = await zip.file("docProps/core.xml")?.async("string");
    expect(coreXml).toContain("Careerkit");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");
    expect(stylesXml).toContain("Calibri");
  });
});
