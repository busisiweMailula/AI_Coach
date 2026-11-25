import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import type { StructuredCv, CvLine, CvSection } from "./structured-cv.js";

const ACCENT = "2457C5";

export async function createResumeWordDocument(cv: StructuredCv): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];
  if (cv.header.name.trim()) {
    paragraphs.push(new Paragraph({
      style: "Title",
      children: [new TextRun({ text: cv.header.name, bold: true })],
    }));
  }
  const contact = [
    cv.header.headline,
    cv.header.phone,
    cv.header.email,
    cv.header.location,
    ...cv.header.links,
  ].filter((value) => value.trim());
  if (contact.length) paragraphs.push(new Paragraph({ children: [new TextRun(contact.join(" | "))] }));
  const knownHeaderValues = new Set(contact.map(normalize));
  if (cv.header.name.trim()) knownHeaderValues.add(normalize(cv.header.name));
  for (const sourceLine of cv.header.sourceLines) {
    const extras = sourceLine.text.split(/[|•·]/).map((value) => value.trim())
      .filter((value) => value && !knownHeaderValues.has(normalize(value)));
    if (extras.length) paragraphs.push(new Paragraph({ children: [new TextRun(extras.join(" | "))] }));
  }

  for (const section of cv.sections) paragraphs.push(...renderSection(section));

  const document = new Document({
    creator: "Careerkit",
    title: "Resume",
    numbering: {
      config: [{
        reference: "resume-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 180 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 21, color: "25334A" },
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
          run: { font: "Calibri", size: 36, bold: true, color: "173B69" },
          paragraph: { spacing: { after: 60 }, keepNext: true },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Calibri", size: 23, bold: true, color: ACCENT, allCaps: true },
          paragraph: { spacing: { before: 220, after: 80 }, keepNext: true },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      children: paragraphs,
    }],
  });
  return Packer.toBuffer(document);
}

function renderSection(section: CvSection): Paragraph[] {
  const content = section.paragraphs.filter((line) => line.text.trim());
  const groups = section.groups.filter((group) => group.label.trim() || group.value.trim());
  const entries = section.entries.filter((entry) =>
    entry.title.trim() || entry.company.trim() || entry.location.trim() ||
    entry.dates.trim() || entry.lines.some((line) => line.text.trim()));
  if (content.length === 0 && groups.length === 0 && entries.length === 0) return [];

  const result = [new Paragraph({
    heading: HeadingLevel.HEADING_1,
    style: "Heading1",
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 3 } },
    children: [new TextRun({ text: section.heading, bold: true })],
  })];

  if ((section.type === "core_competencies" || section.type === "technical_skills") && groups.length) {
    for (const group of groups) {
      result.push(new Paragraph({
        keepLines: true,
        children: [
          ...(group.label ? [new TextRun({ text: `${group.label}: `, bold: true })] : []),
          new TextRun(group.value),
        ],
      }));
    }
    return result;
  }

  if ((section.type === "experience" || section.type === "projects") && entries.length) {
    for (const entry of entries) {
      const titleAndCompany = [entry.title, entry.company, entry.location]
        .filter((value) => value.trim()).join(" | ");
      if (titleAndCompany || entry.dates) {
        result.push(new Paragraph({
          keepNext: true,
          keepLines: true,
          tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
          children: [
            new TextRun({ text: titleAndCompany, bold: true }),
            ...(entry.dates ? [new TextRun({ text: `\t${entry.dates}` })] : []),
          ],
        }));
      }
      result.push(...entry.lines.filter((line) => line.text.trim()).map((line) => renderLine(line, section)));
    }
    return result;
  }

  result.push(...content.map((line) => renderLine(line, section)));
  return result;
}

function renderLine(line: CvLine, section: CvSection): Paragraph {
  const label = section.type === "projects"
    ? /^((?:Objective|Technologies|Contribution|Outcome):)\s*(.*)$/i.exec(line.text)
    : null;
  const children = label
    ? [new TextRun({ text: `${label[1]} `, bold: true }), new TextRun(label[2] ?? "")]
    : [new TextRun({ text: line.text, bold: line.bold })];
  if (line.kind === "bullet") {
    return new Paragraph({
      numbering: { reference: "resume-bullets", level: 0 },
      keepLines: true,
      children,
    });
  }
  if (line.kind === "date") {
    return new Paragraph({
      keepNext: true,
      tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
      children: [new TextRun({ text: `\t${line.text}` })],
    });
  }
  return new Paragraph({ keepLines: true, children });
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}
