import { createHash } from "node:crypto";
import { z } from "zod";

export const ResumeSectionTypeSchema = z.enum([
  "summary",
  "core_competencies",
  "technical_skills",
  "experience",
  "projects",
  "education",
  "certifications",
  "additional_information",
  "references",
  "custom",
]);

export const ResumeSuggestionTargetSchema = z.object({
  sectionType: ResumeSectionTypeSchema,
  sectionSubtype: z.string().optional(),
  entryId: z.string().optional(),
  bulletId: z.string().optional(),
  field: z.enum(["text", "title", "company", "location", "dates", "objective", "technologies", "contribution", "outcome"]),
  operation: z.literal("replace"),
  before: z.string().min(1),
  after: z.string().min(1),
}).strict();

export type ResumeSectionType = z.infer<typeof ResumeSectionTypeSchema>;
export type ResumeSuggestionTarget = z.infer<typeof ResumeSuggestionTargetSchema>;

export const AnchoredSuggestionSchema = z.object({
  sectionId: z.string().min(1),
  entryId: z.string().min(1).optional(),
  bulletId: z.string().min(1).optional(),
  field: z.enum(["text", "title", "company", "location", "dates"]),
  operation: z.enum(["replace", "add", "remove"]),
  proposedText: z.string().max(2000),
  reason: z.string().min(1).max(1000),
  jobRequirement: z.string().min(1).max(1000),
  needsUserInput: z.string().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.operation !== "remove" && !value.proposedText.trim()) {
    context.addIssue({ code: "custom", path: ["proposedText"], message: "Text is required for this operation" });
  }
  if (value.operation === "add" && value.field !== "text") {
    context.addIssue({ code: "custom", path: ["field"], message: "Only text targets can be added" });
  }
});

export type AnchoredSuggestion = z.infer<typeof AnchoredSuggestionSchema>;

export interface CvLine {
  id: string;
  text: string;
  kind: "paragraph" | "bullet" | "date";
  bold?: boolean;
}

export interface CvEntry {
  id: string;
  title: string;
  dates: string;
  company: string;
  location: string;
  lines: CvLine[];
}

export interface CvSection {
  id: string;
  type: ResumeSectionType;
  subtype?: string;
  heading: string;
  paragraphs: CvLine[];
  groups: Array<{ id: string; sourceLineId: string; label: string; value: string }>;
  entries: CvEntry[];
}

export interface StructuredCv {
  header: {
    name: string;
    headline: string;
    phone: string;
    email: string;
    location: string;
    links: string[];
    sourceLines: CvLine[];
  };
  sections: CvSection[];
  lossless: {
    coverage: number;
    verified: boolean;
  };
}

export interface SourceLine {
  text: string;
  kind?: "paragraph" | "bullet" | "date";
  bold?: boolean;
  heading?: boolean;
}

export const DEFAULT_RESUME_HEADINGS: Readonly<Record<string, ResumeSectionType>> = {
  "PROFESSIONAL SUMMARY": "summary",
  PROFILE: "summary",
  "CORE COMPETENCIES": "core_competencies",
  "TECHNICAL SKILLS": "technical_skills",
  SKILLS: "technical_skills",
  "PROFESSIONAL EXPERIENCE": "experience",
  "WORK EXPERIENCE": "experience",
  "SELECTED TECHNICAL PROJECTS": "projects",
  PROJECTS: "projects",
  "EDUCATION AND QUALIFICATIONS": "education",
  EDUCATION: "education",
  "CERTIFICATIONS AND PROFESSIONAL DEVELOPMENT": "certifications",
  CERTIFICATIONS: "certifications",
  "ADDITIONAL INFORMATION": "additional_information",
  REFERENCES: "references",
};

const DATE_RANGE = /\b(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current)\b/i;
const KNOWN_SECTION_TYPES = new Set<ResumeSectionType>([
  "summary", "core_competencies", "technical_skills", "experience", "projects",
  "education", "certifications", "additional_information", "references",
]);

export function structureCv(
  input: string | SourceLine[],
  headingDictionary: Readonly<Record<string, ResumeSectionType>> = DEFAULT_RESUME_HEADINGS,
  profile: Partial<StructuredCv["header"]> = {},
): StructuredCv {
  const lines: SourceLine[] = (typeof input === "string"
    ? input.replace(/\r\n?/g, "\n").split("\n").map((text) => ({ text }))
    : input)
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter((line) => line.text.length > 0);

  const headerLines: CvLine[] = [];
  const sections: CvSection[] = [];
  let current: CvSection | undefined;
  const headingMap = normalizeHeadingDictionary(headingDictionary);

  for (const [index, line] of lines.entries()) {
    const heading = resolveHeading(line.text, headingMap);
    if (heading) {
      if (heading.continued && current?.type === heading.type && current.heading === heading.text) continue;
      current = makeSection(heading.type, heading.text, index);
      sections.push(current);
      continue;
    }

    if (line.heading || looksLikeHeading(line.text)) {
      current = makeSection("custom", line.text, index);
      sections.push(current);
      continue;
    }

    const cvLine = makeLine(line, index);
    if (!current) headerLines.push(cvLine);
    else addLine(current, cvLine);
  }

  const header = {
    name: profile.name ?? headerLines[0]?.text ?? "",
    headline: profile.headline ?? headerLines[1]?.text ?? "",
    phone: profile.phone ?? findContact(headerLines.map((line) => line.text).join(" "), /(?:\+?\d[\d ()-]{6,}\d)/),
    email: profile.email ?? findContact(headerLines.map((line) => line.text).join(" "), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
    location: profile.location ?? "",
    links: profile.links ?? findLinks(headerLines.map((line) => line.text).join(" ")),
    sourceLines: headerLines,
  };

  for (const section of sections) {
    if (section.type === "experience" || section.type === "projects") groupEntries(section);
    if (section.type === "core_competencies" || section.type === "technical_skills") {
      section.groups = section.paragraphs.map((line) => {
        const match = /^([^:]{1,60}):\s*(.*)$/.exec(line.text);
        return {
          id: stableId(`${line.id}:group`),
          sourceLineId: line.id,
          label: match?.[1]?.trim() ?? "",
          value: match?.[2]?.trim() ?? line.text,
        };
      });
    }
  }

  const reconstructed = [
    ...headerLines.map((line) => line.text),
    ...sections.flatMap((section) => [section.heading, ...section.paragraphs.map((line) => line.text)]),
  ].join("\n");
  const source = lines.map((line) => line.text).join("\n");
  const coverage = calculateCoverage(source, reconstructed);
  return {
    header,
    sections,
    lossless: { coverage, verified: coverage === 1 },
  };
}

  export function getAnchoredOriginal(cv: StructuredCv, target: AnchoredSuggestion): string | null {
    const section = cv.sections.find((item) => item.id === target.sectionId);
    if (!section) return null;
    if ((section.type === "experience" || section.type === "projects") && !target.entryId) return null;

    if (target.entryId) {
      const entry = section.entries.find((item) => item.id === target.entryId);
      if (!entry) return null;
      if (target.field !== "text") return entry[target.field] || null;
      if (!target.bulletId) return entry.lines.map((line) => line.text).join("\n") || null;
      return entry.lines.find((line) => line.id === target.bulletId)?.text ?? null;
    }

    if (target.bulletId) {
      const group = section.groups.find((item) => item.id === target.bulletId);
      if (group) return group.label ? `${group.label}: ${group.value}` : group.value;
      return section.paragraphs.find((line) => line.id === target.bulletId)?.text ?? null;
    }
    if (target.field === "text") {
      return section.type === "core_competencies" || section.type === "technical_skills"
        ? section.groups.map((group) => group.label ? `${group.label}: ${group.value}` : group.value).join("\n")
        : section.paragraphs.map((line) => line.text).join("\n");
    }
    return null;
  }

  export function anchoredTargetKey(target: AnchoredSuggestion): string {
    return `${target.sectionId}:${target.entryId ?? ""}:${target.bulletId ?? ""}:${target.field}`;
  }

  export function applyAnchoredSuggestion(
    cv: StructuredCv,
    target: AnchoredSuggestion,
    suggestionId: string,
  ): { cv: StructuredCv; applied: boolean } {
    if (getAnchoredOriginal(cv, target) === null) return { cv, applied: false };
    let applied = false;
    const sections = cv.sections.map((section) => {
      if (section.id !== target.sectionId) return section;
      if (target.entryId) {
        const entries = section.entries.map((entry) => {
          if (entry.id !== target.entryId) return entry;
          if (target.field !== "text") {
            applied = true;
            return {
              ...entry,
              [target.field]: target.operation === "remove" ? "" : target.proposedText,
            };
          }
          const lines = [...entry.lines];
          if (!target.bulletId) {
            applied = true;
            return {
              ...entry,
              lines: target.operation === "remove" ? []
                : target.operation === "add"
                  ? [...lines, { id: suggestionId, text: target.proposedText, kind: "bullet" as const }]
                  : [{ id: suggestionId, text: target.proposedText, kind: "paragraph" as const }],
            };
          }
          const index = lines.findIndex((line) => line.id === target.bulletId);
          if (index < 0) return entry;
          applied = true;
          if (target.operation === "remove") lines.splice(index, 1);
          else if (target.operation === "add") {
            lines.splice(index + 1, 0, {
              id: suggestionId,
              text: target.proposedText,
              kind: "bullet",
            });
          } else {
            lines[index] = { ...lines[index]!, text: target.proposedText };
          }
          return { ...entry, lines };
        });
        return { ...section, entries };
      }

      if (!target.bulletId) {
        applied = true;
        const paragraphs = target.operation === "remove" ? []
          : target.operation === "add"
            ? [...section.paragraphs, { id: suggestionId, text: target.proposedText, kind: "paragraph" as const }]
            : [{ id: suggestionId, text: target.proposedText, kind: "paragraph" as const }];
        const groups = target.operation === "remove" || target.operation === "replace"
          ? []
          : section.type === "core_competencies" || section.type === "technical_skills"
            ? [...section.groups, {
                id: suggestionId,
                sourceLineId: suggestionId,
                label: "",
                value: target.proposedText,
              }]
            : section.groups;
        const entries = target.operation === "remove" || target.operation === "replace" ? [] : section.entries;
        return {
          ...section,
          paragraphs,
          groups,
          entries,
        };
      }

      const group = section.groups.find((item) => item.id === target.bulletId);
      if (group) {
        applied = true;
        const groups = target.operation === "remove"
          ? section.groups.filter((item) => item.id !== group.id)
          : target.operation === "add"
            ? section.groups.flatMap((item) => item.id === group.id
              ? [item, { id: suggestionId, sourceLineId: suggestionId, label: "", value: target.proposedText }]
              : [item])
            : section.groups.map((item) => item.id === group.id ? { ...item, value: target.proposedText } : item);
        const paragraphs = target.operation === "remove"
          ? section.paragraphs.filter((line) => line.id !== group.sourceLineId)
          : target.operation === "add"
            ? section.paragraphs.flatMap((line) => line.id === group.sourceLineId
              ? [line, { id: suggestionId, text: target.proposedText, kind: "paragraph" as const }]
              : [line])
            : section.paragraphs.map((line) => line.id === group.sourceLineId
              ? { ...line, text: group.label ? `${group.label}: ${target.proposedText}` : target.proposedText }
              : line);
        return { ...section, groups, paragraphs };
      }

      const paragraphs = [...section.paragraphs];
      const index = paragraphs.findIndex((line) => line.id === target.bulletId);
      if (index < 0) return section;
      applied = true;
      if (target.operation === "remove") paragraphs.splice(index, 1);
      else if (target.operation === "add") {
        paragraphs.splice(index + 1, 0, { id: suggestionId, text: target.proposedText, kind: "bullet" });
      } else {
        paragraphs[index] = { ...paragraphs[index]!, text: target.proposedText };
      }
      return { ...section, paragraphs };
    });
    return applied
      ? { cv: { ...cv, sections, lossless: { coverage: 1, verified: true } }, applied: true }
      : { cv, applied: false };
  }

export function applyResumeSuggestion(
  cv: StructuredCv,
  inputTarget: ResumeSuggestionTarget,
): { cv: StructuredCv; applied: boolean } {
  const parsed = ResumeSuggestionTargetSchema.safeParse(inputTarget);
  if (!parsed.success) return { cv, applied: false };
  const target = parsed.data;
  let matched = 0;
  const sections = cv.sections.map((section) => {
    if (section.type !== target.sectionType ||
      (target.sectionSubtype && (section.subtype ?? section.heading) !== target.sectionSubtype)) {
      return section;
    }
    const targetEntry = target.entryId ? section.entries.find((entry) => entry.id === target.entryId) : undefined;
    const targetEntryLines = targetEntry?.lines.filter((line) =>
      (!target.bulletId || line.id === target.bulletId) && line.text.includes(target.before)) ?? [];
    const targetLineIds = target.entryId
      ? new Set(targetEntryLines.length === 1 ? [targetEntryLines[0]?.id ?? ""] : [])
      : null;
    const paragraphs = section.paragraphs.map((line) => {
      if (target.field !== "text") return line;
      if (targetLineIds && !targetLineIds.has(line.id)) return line;
      const updated = replaceUnique(line.text, target.before, target.after);
      if (updated === null) return line;
      matched += 1;
      return { ...line, text: updated };
    });
    const entries = section.entries.map((entry) => {
      if (!target.entryId || entry.id !== target.entryId) return entry;
      const lines = entry.lines.map((line) => {
        if (targetLineIds && !targetLineIds.has(line.id)) return line;
        if (target.field === "text") {
          const updated = replaceUnique(line.text, target.before, target.after);
          if (updated === null) return line;
          return { ...line, text: updated };
        }
        return line;
      });
      return { ...entry, lines };
    });
    return { ...section, paragraphs, entries };
  });
  if (matched !== 1) return { cv, applied: false };
  return { cv: { ...cv, sections, lossless: { coverage: 1, verified: true } }, applied: true };
}

export function findSuggestionTarget(
  cv: StructuredCv,
  before: string,
  after: string,
): ResumeSuggestionTarget | null {
  const candidates: ResumeSuggestionTarget[] = [];
  for (const section of cv.sections) {
    if (section.type === "experience" || section.type === "projects") {
      for (const entry of section.entries) {
        for (const line of entry.lines) {
          if (line.text.includes(before)) candidates.push({
            sectionType: section.type,
            ...(section.subtype ? { sectionSubtype: section.subtype } : {}),
            entryId: entry.id,
            ...(line.kind === "bullet" ? { bulletId: line.id } : {}),
            field: "text",
            operation: "replace",
            before,
            after,
          });
        }
      }
      continue;
    }
    for (const line of section.paragraphs) {
      if (line.text.includes(before)) candidates.push({
        sectionType: section.type,
        ...(section.subtype ? { sectionSubtype: section.subtype } : {}),
        field: "text",
        operation: "replace",
        before,
        after,
      });
    }
  }
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function normalizeHeadingDictionary(dictionary: Readonly<Record<string, ResumeSectionType>>) {
  return new Map(Object.entries(dictionary).map(([heading, type]) => [normalizeHeading(heading), type]));
}

function resolveHeading(text: string, dictionary: Map<string, ResumeSectionType>) {
  const normalized = normalizeHeading(text);
  const continued = normalized.endsWith(" (CONTINUED)");
  const plain = continued ? normalized.slice(0, -" (CONTINUED)".length) : normalized;
  const type = dictionary.get(plain);
  return type && KNOWN_SECTION_TYPES.has(type) ? { type, text: plain, continued } : null;
}

function normalizeHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/:$/, "").toLocaleUpperCase("en");
}

function looksLikeHeading(text: string, bold?: boolean): boolean {
  return text.length <= 70 && (Boolean(bold) || (/^[A-Z0-9][A-Z0-9 &/()'-]*$/.test(text) && /[A-Z]/.test(text)));
}

function makeSection(type: ResumeSectionType, heading: string, index: number): CvSection {
  return { id: stableId(`section:${type}:${index}:${heading}`), type, heading, paragraphs: [], groups: [], entries: [] };
}

function makeLine(line: SourceLine, index: number): CvLine {
  const bullet = line.kind === "bullet" || /^(?:[-*•▪●])\s+/.test(line.text);
  const text = bullet ? line.text.replace(/^(?:[-*•▪●])\s+/, "") : line.text;
  return {
    id: stableId(`line:${index}:${text}`),
    text,
    kind: line.kind === "date" || DATE_RANGE.test(text) ? "date" : bullet ? "bullet" : "paragraph",
    ...(line.bold ? { bold: true } : {}),
  };
}

function addLine(section: CvSection, line: CvLine): void {
  section.paragraphs.push(line);
}

function groupEntries(section: CvSection): void {
  const entries: CvEntry[] = [];
  let active: CvEntry | undefined;
  for (const [index, line] of section.paragraphs.entries()) {
    const inline = /^(.+?)\s+((?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current))\s+(.+?)(?:\s*\|\s*(.+))?$/i.exec(line.text);
    if (inline) {
      active = {
        id: stableId(`entry:${section.id}:${index}:${line.text}`),
        title: inline[1]?.trim() ?? "",
        dates: inline[2]?.trim() ?? "",
        company: inline[3]?.trim() ?? "",
        location: inline[4]?.trim() ?? "",
        lines: [],
      };
      entries.push(active);
      continue;
    }

    if (line.kind === "date" || DATE_RANGE.test(line.text)) {
      if (!active || active.dates || active.lines.length > 0) {
        active = makeEntry(section, index, "", line.text);
        entries.push(active);
      } else {
        active.dates = line.text.match(DATE_RANGE)?.[0] ?? line.text;
      }
      continue;
    }

    if (line.kind === "bullet") {
      if (!active) {
        active = makeEntry(section, index, "", "");
        entries.push(active);
      }
      active.lines.push(line);
      continue;
    }

    if (!active || active.dates || active.lines.length > 0 || active.title) {
      active = makeEntry(section, index, line.text, "");
      entries.push(active);
      continue;
    }
    active.title = line.text;
  }
  section.entries = entries;
}

function makeEntry(section: CvSection, index: number, title: string, dates: string): CvEntry {
  return {
    id: stableId(`entry:${section.id}:${index}:${title}:${dates}`),
    title,
    dates: dates.match(DATE_RANGE)?.[0] ?? dates,
    company: "",
    location: "",
    lines: [],
  };
}

function calculateCoverage(source: string, structured: string): number {
  const normalize = (value: string) => value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/\(CONTINUED\)\s*$/i.test(line.trim()))
    .join(" ")
    .replace(/[•▪●*-]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
  const normalizedSource = normalize(source);
  const normalizedStructured = normalize(structured);
  if (normalizedSource === normalizedStructured) return 1;
  const words: string[] = normalizedSource.match(/[\p{L}\p{N}]+/gu) ?? [];
  const structuredWords: string[] = normalizedStructured.match(/[\p{L}\p{N}]+/gu) ?? [];
  let cursor = 0;
  let matched = 0;
  for (const word of words) {
    const position = structuredWords.indexOf(word, cursor);
    if (position < 0) continue;
    matched += 1;
    cursor = position + 1;
  }
  return words.length === 0 ? 1 : matched / words.length;
}

function findContact(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[0] ?? "";
}

function findLinks(text: string): string[] {
  return [...text.matchAll(/(?:https?:\/\/|www\.)[^\s,]+/gi)].map((match) => match[0]);
}

function replaceUnique(value: string, before: string, after: string): string | null {
  const first = value.indexOf(before);
  if (first < 0 || value.indexOf(before, first + before.length) >= 0) return null;
  return `${value.slice(0, first)}${after}${value.slice(first + before.length)}`;
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
