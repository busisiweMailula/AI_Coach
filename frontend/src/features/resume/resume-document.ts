import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  PositionalTab,
  PositionalTabAlignment,
  PositionalTabLeader,
  PositionalTabRelativeTo,
  TabStopType,
  TextRun,
} from "docx";
import type { StructuredCv, StructuredCvLine, StructuredCvSection } from "../../api/client";

const accent = "2457C5";
const font = "Calibri";

export async function createResumeWordDocument(cv: StructuredCv): Promise<Blob> {
  const children: Paragraph[] = [];
  if (cv.header.name.trim()) {
    children.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: cv.header.name, bold: true })],
    }));
  }
  if (cv.header.headline.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: cv.header.headline, bold: true })],
      spacing: { after: 60 },
    }));
  }
  const contact = [
    cv.header.phone,
    cv.header.email,
    cv.header.location,
    ...cv.header.links,
  ].map((value) => value.trim()).filter(Boolean).join(" | ");
  if (contact) children.push(new Paragraph({ children: [new TextRun(contact)] }));

  for (const section of cv.sections) appendSection(children, section);

  const document = new Document({
    creator: "Careerkit",
    title: "Resume draft",
    subject: "Editable resume",
    styles: {
      default: {
        document: {
          run: { font, size: 22, color: "25334A" },
          paragraph: { spacing: { after: 90, line: 276 }, keepLines: true },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font, size: 36, bold: true, color: "173B69" },
          paragraph: { spacing: { after: 100 }, keepNext: true, keepLines: true },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font, size: 24, bold: true, color: accent, allCaps: true },
          paragraph: { spacing: { before: 240, after: 90 }, keepNext: true, keepLines: true },
        },
      ],
    },
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
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      children,
    }],
  });
  return Packer.toBlob(document);
}

function appendSection(children: Paragraph[], section: StructuredCvSection): void {
  if (section.lines.every((line) => !line.text.trim())) return;
  if (section.heading.trim()) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 4 },
      },
      spacing: { before: 240, after: 90 },
      keepNext: true,
      keepLines: true,
      children: [new TextRun({ text: section.heading.toLocaleUpperCase(), bold: true })],
    }));
  }

  const entriesByFirstLine = new Map(
    section.entries
      .filter((entry) => entry.lineIds.length > 0)
      .map((entry) => [entry.lineIds[0], entry]),
  );
  const emittedEntries = new Set<string>();
  for (const line of section.lines) {
    const entry = entriesByFirstLine.get(line.id);
    if (entry && emittedEntries.has(entry.id)) continue;
    if (entry) emittedEntries.add(entry.id);
    children.push(formatLine(line, section, entry));
  }
}

function formatLine(line: StructuredCvLine, section: StructuredCvSection, entry?: StructuredCvSection["entries"][number]): Paragraph {
  if (line.kind === "bullet") {
    return new Paragraph({
      numbering: { reference: "resume-bullets", level: 0 },
      keepLines: true,
      children: [new TextRun({ text: line.text })],
    });
  }

  if (entry && section.type === "experience" && line.id === entry.lineIds[0]) {
    const company = [entry.company, entry.location].filter(Boolean).join(" | ");
    return new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
      keepNext: true,
      keepLines: true,
      children: [
        new TextRun({ text: entry.title || line.text, bold: true }),
        ...(company ? [new TextRun({ text: `  ${company}`, bold: true })] : []),
        ...(entry.dates ? [
          new TextRun({
            children: [new PositionalTab({
              alignment: PositionalTabAlignment.RIGHT,
              relativeTo: PositionalTabRelativeTo.MARGIN,
              leader: PositionalTabLeader.NONE,
            })],
          }),
          new TextRun({ text: entry.dates }),
        ] : []),
      ],
    });
  }

  const label = section.type === "technicalSkills" || section.type === "coreCompetencies"
    ? /^([^:]{1,60}:)\s*(.*)$/.exec(line.text)
    : section.type === "projects"
      ? /^(Objective|Technologies|Contribution|Outcome):\s*(.*)$/i.exec(line.text)
      : null;
  if (label) {
    return new Paragraph({
      keepLines: true,
      children: [
        new TextRun({ text: label[1], bold: true }),
        new TextRun({ text: label[2] ? ` ${label[2]}` : "" }),
      ],
    });
  }

  return new Paragraph({
    alignment: line.alignRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
    keepLines: true,
    children: [new TextRun({
      text: line.text,
      bold: line.bold,
      ...(line.fontSize ? { size: Math.max(20, Math.min(24, Math.round(line.fontSize * 2))) } : {}),
    })],
  });
}
