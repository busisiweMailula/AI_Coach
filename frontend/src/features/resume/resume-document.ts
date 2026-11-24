import { BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseResumeSections } from "./resume-format";

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
  const sections = parseResumeSections(content);
  const paragraphs: Paragraph[] = [];
  let isTitle = true;

  for (const section of sections) {
    if (section.heading) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "9AAFC8", space: 4 },
        },
        children: [new TextRun({ text: section.heading, bold: true })],
      }));
    }

    for (const line of section.lines) {
      const bullet = line.match(/^(?:[-*•▪●])\s+(.*)$/);
      if (bullet) {
        paragraphs.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(bullet[1])],
        }));
      } else if (isTitle) {
        paragraphs.push(new Paragraph({
          heading: HeadingLevel.TITLE,
          children: [new TextRun({ text: line, bold: true })],
        }));
        isTitle = false;
      } else {
        paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
      }
    }
  }

  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: "Resume draft", bold: true })],
    }));
  }
  return paragraphs;
}
