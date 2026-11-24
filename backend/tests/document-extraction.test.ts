import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocument } from "../src/infra/files/document-extractor.js";
import { structureCv } from "../src/modules/resumes/structured-cv.js";

describe("structured document extraction", () => {
  it("preserves DOCX paragraphs, heading styles, numbering, bold, and right alignment", async () => {
    const archive = new JSZip();
    archive.file("[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>");
    archive.file("word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr><w:t>PROFESSIONAL EXPERIENCE</w:t></w:r></w:p>" +
      "<w:p><w:pPr><w:jc w:val=\"right\"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>2022 - Present</w:t></w:r></w:p>" +
      "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr><w:r><w:t>Built reliable systems.</w:t></w:r></w:p>" +
      "<w:sectPr/></w:body></w:document>");
    archive.file("word/numbering.xml",
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>');
    const buffer = await archive.generateAsync({ type: "nodebuffer" });
    const extracted = await extractDocument(
      buffer,
      "resume.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ["docx"],
    );
    const cv = structureCv(extracted.text, extracted.lines);

    expect(extracted.text).toContain("PROFESSIONAL EXPERIENCE");
    expect(extracted.lines[0]).toMatchObject({ styleName: "Heading1", bold: true, fontSize: 16 });
    expect(extracted.lines[1]).toMatchObject({ alignRight: true, bold: true });
    expect(extracted.lines[2]).toMatchObject({ kind: "bullet" });
    expect(cv.sections[0].type).toBe("experience");
    expect(cv.sections[0].lines[1]).toMatchObject({ kind: "bullet", text: "Built reliable systems." });
  });
});
