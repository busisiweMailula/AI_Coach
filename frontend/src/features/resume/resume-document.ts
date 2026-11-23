import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export async function createResumeWordDocument(content: string): Promise<Blob> {
  const paragraphs = formatResumeParagraphs(content);
  const document = new Document({
    creator: "Careerkit",
    title: "Resume draft",
    styles: {
      default: {
        document: {
          run: { font: "Aptos", size: 22, color: "25334A" },
          paragraph: { spacing: { after: 90, line: 276 } },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos Display", size: 36, bold: true, color: "173B69" },
          paragraph: { spacing: { after: 180 } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos", size: 25, bold: true, color: "2457C5" },
          paragraph: { spacing: { before: 240, after: 90 }, keepNext: true },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 900, bottom: 720, left: 900 },
        },
      },
      children: paragraphs,
    }],
  });

  return Packer.toBlob(document);
}

function formatResumeParagraphs(content: string): Paragraph[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) lines.push("Resume draft");

  return lines.map((line, index) => {
    if (index === 0) {
      return new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: line, bold: true })],
      });
    }

    if (isSectionHeading(line)) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: line, bold: true })],
      });
    }

    const bullet = line.match(/^(?:[-*•▪●])\s+(.*)$/);
    if (bullet) {
      return new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(bullet[1])],
      });
    }

    return new Paragraph({ children: [new TextRun(line)] });
  });
}

function isSectionHeading(line: string) {
  return line.toLowerCase() === "accepted cv updates" ||
    (line.length <= 70 && /^[A-Z0-9][A-Z0-9 &/()'-]*$/.test(line) && /[A-Z]/.test(line));
}
