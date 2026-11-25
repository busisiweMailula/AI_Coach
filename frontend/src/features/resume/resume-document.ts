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
import type { StructuredCv, StructuredCvLine, StructuredCvSection } from "../../api/client.js";

const ACCENT = "2457C5";

export async function createResumeWordDocument(cv: StructuredCv): Promise<Blob> {
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
  ].filter((value) => value.trim()).join(" | ");
  if (contact) paragraphs.push(new Paragraph({ children: [new TextRun(contact)] }));

  for (const section of cv.sections) paragraphs.push(...renderSection(section));

  const document = new Document({
    creator: "Careerkit",
    title: "Resume draft",
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
  return Packer.toBlob(document);
}

function renderSection(section: StructuredCvSection): Paragraph[] {
  const content = section.paragraphs.filter((line) => line.text.trim());
  const groups = section.groups.filter((group) => group.label.trim() || group.value.trim());
  if (content.length === 0 && groups.length === 0 && section.entries.length === 0) return [];

  const result = [new Paragraph({
    heading: HeadingLevel.HEADING_1,
    style: "Heading1",
    keepNext: true,
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 3 },
    },
    children: [new TextRun({ text: section.heading.toLocaleUpperCase("en"), bold: true })],
  })];

  if (section.type === "core_competencies" || section.type === "technical_skills") {
    if (groups.length) {
      for (const group of groups) {
        const label = group.label ? `${group.label}: ` : "";
        result.push(new Paragraph({
          keepLines: true,
          children: [new TextRun({ text: label, bold: Boolean(group.label) }), new TextRun(group.value)],
        }));
      }
      return result;
    }
  }

  if (section.type === "experience" && section.entries.length > 0) {
    for (const entry of section.entries) {
      const titleAndCompany = [entry.title, entry.company, entry.location]
        .filter((value) => value.trim())
        .join(" | ");
      if (titleAndCompany || entry.dates) {
        result.push(new Paragraph({
          keepNext: true,
          keepLines: true,
          tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
          children: [
            new TextRun({ text: titleAndCompany, bold: true }),
            ...(entry.dates ? [
              new TextRun({ text: "\t" }),
              new TextRun({ text: entry.dates }),
            ] : []),
          ],
        }));
      }
      for (const line of entry.lines) result.push(renderLine(line, section.type));
    }
    return result;
  }

  for (const line of content) result.push(renderLine(line, section.type));
  return result;
}

function renderLine(line: StructuredCvLine, sectionType: StructuredCvSection["type"]): Paragraph {
  const label = sectionType === "projects"
    ? /^((?:Objective|Technologies|Contribution|Outcome):)\s*(.*)$/i.exec(line.text)
    : null;
  const text = label
    ? [new TextRun({ text: `${label[1]} `, bold: true }), new TextRun(label[2] ?? "")]
    : [new TextRun({ text: line.text, bold: line.bold })];
  if (line.kind === "bullet") {
    return new Paragraph({
      numbering: { reference: "resume-bullets", level: 0 },
      keepLines: true,
      children: text,
    });
  }
  if (line.kind === "date") {
    return new Paragraph({
      keepNext: true,
      tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
      children: [new TextRun({ text: `\t${line.text}` })],
    });
  }
  return new Paragraph({ keepLines: true, children: text });
}

export function updateStructuredCvLine(cv: StructuredCv, lineId: string, text: string): StructuredCv {
  return {
    ...cv,
    sections: cv.sections.map((section) => ({
      ...section,
      paragraphs: section.paragraphs.map((line) => line.id === lineId ? { ...line, text } : line),
      entries: section.entries.map((entry) => ({
        ...entry,
        lines: entry.lines.map((line) => line.id === lineId ? { ...line, text } : line),
      })),
    })),
  };
}

export function applyDraftTarget(
  cv: StructuredCv,
  target: import("../../api/client.js").ResumeSuggestionTarget,
): StructuredCv | null {
  const matches: StructuredCvLine[] = [];
  for (const section of cv.sections) {
    if (section.type !== target.sectionType ||
      (target.sectionSubtype && (section.subtype ?? section.heading) !== target.sectionSubtype)) continue;
    for (const line of section.paragraphs) {
      if ((!target.bulletId || line.id === target.bulletId) && line.text.includes(target.before)) matches.push(line);
    }
  }
  if (matches.length !== 1) return null;
  const line = matches[0];
  if (!line) return null;
  const index = line.text.indexOf(target.before);
  const text = `${line.text.slice(0, index)}${target.after}${line.text.slice(index + target.before.length)}`;
  return updateStructuredCvLine(cv, line.id, text);
}
