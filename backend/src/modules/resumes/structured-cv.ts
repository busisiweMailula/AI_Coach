import { createHash } from "node:crypto";
import { z } from "zod";

export type CvSectionType =
  | "summary"
  | "coreCompetencies"
  | "technicalSkills"
  | "experience"
  | "projects"
  | "education"
  | "certifications"
  | "additionalInformation"
  | "references"
  | "custom";

export interface StructuredCvLine {
  id: string;
  text: string;
  kind: "paragraph" | "bullet";
  bold?: boolean;
  fontSize?: number;
  alignRight?: boolean;
  styleName?: string;
}

export interface StructuredCvEntry {
  id: string;
  title: string;
  dates: string;
  company: string;
  location: string;
  fields: Partial<Record<"Objective" | "Technologies" | "Contribution" | "Outcome", string>>;
  bullets: StructuredCvLine[];
  lineIds: string[];
}

export interface StructuredCvSection {
  id: string;
  type: CvSectionType;
  heading: string;
  sourceHeadings: string[];
  lines: StructuredCvLine[];
  entries: StructuredCvEntry[];
}

export interface StructuredCv {
  version: 1;
  header: {
    name: string;
    headline: string;
    phone: string;
    email: string;
    location: string;
    links: string[];
  };
  sections: StructuredCvSection[];
  coverage: number;
  needsReview: boolean;
}

export interface SuggestionTarget {
  sectionType: CvSectionType;
  sectionSubtype?: string;
  entryId?: string;
  bulletId?: string;
  field?: string;
  operation: "replace";
  before: string;
  after: string;
}

export interface TargetedResumeSuggestion {
  id: string;
  originalText: string;
  proposedText: string;
  sourceSnippet?: string;
  status: "accepted" | "pending" | "rejected";
  target?: SuggestionTarget | null;
}

export interface StructuredSuggestionResult {
  structuredCv: StructuredCv;
  appliedSuggestionIds: string[];
  needsPlacement: Array<{ suggestionId: string; reason: string }>;
}

export const suggestionTargetSchema = z.object({
  sectionType: z.enum([
    "summary",
    "coreCompetencies",
    "technicalSkills",
    "experience",
    "projects",
    "education",
    "certifications",
    "additionalInformation",
    "references",
    "custom",
  ]),
  sectionSubtype: z.string().max(200).optional(),
  entryId: z.string().max(100).optional(),
  bulletId: z.string().max(100).optional(),
  field: z.string().max(200).optional(),
  operation: z.literal("replace"),
  before: z.string().min(1).max(2000),
  after: z.string().min(1).max(2000),
}).strict();

export const structuredCvSchema = z.object({
  version: z.literal(1),
  header: z.object({
    name: z.string().max(200),
    headline: z.string().max(300),
    phone: z.string().max(80),
    email: z.string().max(254),
    location: z.string().max(200),
    links: z.array(z.string().max(500)).max(20),
  }).strict(),
  sections: z.array(z.object({
    id: z.string().min(1).max(100),
    type: z.enum([
      "summary",
      "coreCompetencies",
      "technicalSkills",
      "experience",
      "projects",
      "education",
      "certifications",
      "additionalInformation",
      "references",
      "custom",
    ]),
    heading: z.string().max(200),
    sourceHeadings: z.array(z.string().max(200)).max(20),
    lines: z.array(z.object({
      id: z.string().min(1).max(100),
      text: z.string().max(5000),
      kind: z.enum(["paragraph", "bullet"]),
      bold: z.boolean().optional(),
      fontSize: z.number().positive().max(200).optional(),
      alignRight: z.boolean().optional(),
      styleName: z.string().max(100).optional(),
    }).strict()).max(1000),
    entries: z.array(z.object({
      id: z.string().min(1).max(100),
      title: z.string().max(500),
      dates: z.string().max(200),
      company: z.string().max(500),
      location: z.string().max(200),
      fields: z.object({
        Objective: z.string().max(5000).optional(),
        Technologies: z.string().max(5000).optional(),
        Contribution: z.string().max(5000).optional(),
        Outcome: z.string().max(5000).optional(),
      }).strict(),
      bullets: z.array(z.object({
        id: z.string().min(1).max(100),
        text: z.string().max(5000),
        kind: z.enum(["paragraph", "bullet"]),
        bold: z.boolean().optional(),
        fontSize: z.number().positive().max(200).optional(),
        alignRight: z.boolean().optional(),
        styleName: z.string().max(100).optional(),
      }).strict()).max(200),
      lineIds: z.array(z.string().min(1).max(100)).max(1000),
    }).strict()).max(200),
  }).strict()).max(200),
  coverage: z.number().min(0).max(1),
  needsReview: z.boolean(),
}).strict();

export interface CvSourceLine {
  text: string;
  kind?: "paragraph" | "bullet";
  bold?: boolean;
  fontSize?: number;
  alignRight?: boolean;
  styleName?: string;
}

export const DEFAULT_CV_HEADINGS: ReadonlyArray<{
  label: string;
  type: CvSectionType;
  aliases: readonly string[];
}> = [
  { label: "PROFESSIONAL SUMMARY", type: "summary", aliases: ["PROFESSIONAL SUMMARY", "PROFILE", "PROFESSIONAL PROFILE"] },
  { label: "CORE COMPETENCIES", type: "coreCompetencies", aliases: ["CORE COMPETENCIES"] },
  { label: "TECHNICAL SKILLS", type: "technicalSkills", aliases: ["TECHNICAL SKILLS", "SKILLS"] },
  { label: "PROFESSIONAL EXPERIENCE", type: "experience", aliases: ["PROFESSIONAL EXPERIENCE", "WORK EXPERIENCE"] },
  { label: "SELECTED TECHNICAL PROJECTS", type: "projects", aliases: ["SELECTED TECHNICAL PROJECTS", "PROJECTS"] },
  { label: "EDUCATION AND QUALIFICATIONS", type: "education", aliases: ["EDUCATION AND QUALIFICATIONS", "EDUCATION"] },
  { label: "CERTIFICATIONS AND PROFESSIONAL DEVELOPMENT", type: "certifications", aliases: ["CERTIFICATIONS AND PROFESSIONAL DEVELOPMENT", "CERTIFICATIONS"] },
  { label: "ADDITIONAL INFORMATION", type: "additionalInformation", aliases: ["ADDITIONAL INFORMATION"] },
  { label: "REFERENCES", type: "references", aliases: ["REFERENCES"] },
];

const dateRange = /\b(?:19|20)\d{2}\b\s*(?:[–—-]|to)\s*(?:present|current|(?:19|20)\d{2})\b/i;
const bulletPrefix = /^\s*(?:[•▪●◦*-]|\u2022)\s*/;

export function structureCv(
  sourceText: string,
  sourceLines?: CvSourceLine[],
  headingDictionary: ReadonlyArray<{ label: string; type: CvSectionType; aliases: readonly string[] }> = DEFAULT_CV_HEADINGS,
): StructuredCv {
  const parsedLines = (sourceLines?.length ? sourceLines : sourceText.split(/\r?\n/).map((text) => ({ text })))
    .flatMap((line) => line.text.split(/\r?\n/).map((text) => ({ ...line, text })))
    .flatMap((line) => splitInlineHeadings(line, headingDictionary));
  const sections: StructuredCvSection[] = [];
  let current = createSection("custom", "", "", sections.length);

  for (const source of parsedLines.flatMap(splitBulletLines).flatMap(splitEntryBoundaries)) {
    const text = source.text.trim();
    if (!text) continue;
    const heading = matchHeading(text, headingDictionary) ??
      (source.styleName && /^heading/i.test(source.styleName)
        ? { label: text, type: "custom" as const }
        : detectCustomHeading(text));
    if (heading) {
      if ((current.heading || current.lines.length) && !sections.includes(current)) sections.push(current);
      const cleanHeading = heading.label.replace(/\s*\(CONTINUED\)\s*$/i, "").trim();
      const previous = sections[sections.length - 1];
      if (previous && normalizeHeading(previous.heading) === normalizeHeading(cleanHeading)) {
        previous.sourceHeadings.push(text);
        current = previous;
        continue;
      }
      current = createSection(heading.type, cleanHeading, text, sections.length);
      continue;
    }
    const isBullet = source.kind === "bullet" || bulletPrefix.test(source.text);
    const formattedKind = (current.type === "coreCompetencies" || current.type === "technicalSkills")
      ? "paragraph"
      : isBullet ? "bullet" : "paragraph";
    current.lines.push({
      id: stableId("line", current.id, current.lines.length, text),
      text: isBullet ? text.replace(bulletPrefix, "") : text,
      kind: formattedKind,
      ...(source.bold === undefined ? {} : { bold: source.bold }),
      ...(source.fontSize === undefined ? {} : { fontSize: source.fontSize }),
      ...(source.alignRight === undefined ? {} : { alignRight: source.alignRight }),
      ...(source.styleName === undefined ? {} : { styleName: source.styleName }),
    });
  }
  if ((current.heading || current.lines.length) && !sections.includes(current)) sections.push(current);

  const mergedSections = mergeContinuedSections(sections);
  for (const section of mergedSections) {
    section.entries = section.type === "experience" || section.type === "projects"
      ? structureEntries(section)
      : [];
  }
  const structuredSource = structuredCvSourceText(mergedSections);
  const coverage = calculateCoverage(sourceText, structuredSource);
  const isLossless = isStructuredCvLossless(sourceText, {
    version: 1,
    header: { name: "", headline: "", phone: "", email: "", location: "", links: [] },
    sections: mergedSections,
    coverage,
    needsReview: false,
  });

  return {
    version: 1,
    header: { name: "", headline: "", phone: "", email: "", location: "", links: [] },
    sections: mergedSections,
    coverage: isLossless ? 1 : coverage,
    needsReview: !isLossless,
  };
}

function splitBulletLines(line: CvSourceLine): CvSourceLine[] {
  if (line.kind === "bullet") return [line];
  if (!/[•▪●◦]/.test(line.text)) return [line];
  const [before, ...bullets] = line.text.split(/[•▪●◦]\s*/);
  const expandedBullets: CvSourceLine[] = [];
  for (const bullet of bullets) {
    const dateIndex = bullet.search(dateRange);
    if (dateIndex > 0) {
      const boundary = bullet.slice(0, dateIndex).lastIndexOf(". ");
      if (boundary >= 0) {
        const bulletText = bullet.slice(0, boundary + 1).trim();
        const entryText = bullet.slice(boundary + 2).trim();
        if (bulletText) expandedBullets.push({ ...line, text: bulletText, kind: "bullet" });
        if (entryText) expandedBullets.push({ ...line, text: entryText, kind: "paragraph" });
        continue;
      }
    }
    if (bullet.trim()) expandedBullets.push({ ...line, text: bullet.trim(), kind: "bullet" });
  }
  return [
    ...(before.trim() ? [{ ...line, text: before.trim() }] : []),
    ...expandedBullets,
  ];
}

function splitEntryBoundaries(line: CvSourceLine): CvSourceLine[] {
  if (line.kind !== "bullet" && dateRange.test(line.text)) {
    const dateMatch = dateRange.exec(line.text);
    if (dateMatch) {
      const dateIndex = dateMatch.index;
      const boundary = line.text.slice(0, dateIndex).lastIndexOf(". ");
      if (boundary >= 0) {
        const prefix = line.text.slice(0, boundary + 1).trim();
        const rest = line.text.slice(boundary + 2).trim();
        if (prefix && rest) {
          return [
            { ...line, text: prefix, kind: "paragraph" },
            { ...line, text: rest, kind: "paragraph" },
          ];
        }
      }
    }
  }
  if (line.kind !== "bullet") return [line];
  if (parseEntryHeading(line.text)) return [{ ...line, kind: "paragraph" }];
  const secondDateIndex = line.text.search(/(?:\b(?:19|20)\d{2}\b\s*(?:[–—-]|to)\s*(?:present|current|(?:19|20)\d{2}))\b/i);
  if (secondDateIndex > 0) {
    const boundary = line.text.slice(0, secondDateIndex).lastIndexOf(". ");
    if (boundary >= 0) {
      const firstBullet = line.text.slice(0, boundary + 1).trim();
      const secondPart = line.text.slice(boundary + 2).trim();
      const marker = secondPart.indexOf("•");
      const secondEntry = marker >= 0 ? secondPart.slice(0, marker).trim() : secondPart;
      const secondBullet = marker >= 0 ? secondPart.slice(marker).trim().replace(/^[•▪●◦]\s*/, "") : "";
      return [
        ...(firstBullet ? [{ ...line, text: firstBullet, kind: "bullet" as const }] : []),
        ...(secondEntry ? [{ ...line, text: secondEntry, kind: "paragraph" as const }] : []),
        ...(secondBullet ? [{ ...line, text: secondBullet, kind: "bullet" as const }] : []),
      ];
    }
  }
  const dateIndex = line.text.search(dateRange);
  if (dateIndex < 0) return [line];
  const boundary = Math.max(line.text.lastIndexOf(". ", dateIndex), line.text.lastIndexOf("; ", dateIndex));
  if (boundary < 0) return [line];
  const start = boundary + 2;
  const header = line.text.slice(start).trim();
  if (!parseEntryHeading(header)) return [line];
  const bulletText = line.text.slice(0, start).trim();
  return [
    ...(bulletText ? [{ ...line, text: bulletText }] : []),
    { ...line, text: header, kind: "paragraph" },
  ];
}

export function isStructuredCvLossless(sourceText: string, cv: StructuredCv): boolean {
  return normalizeForCoverage(sourceText) === normalizeForCoverage(structuredCvSourceText(cv.sections));
}

export function hasOnlySourceDerivedFields(cv: StructuredCv): boolean {
  for (const section of cv.sections) {
    for (const entry of section.entries) {
      const entryLines = section.lines.filter((line) => entry.lineIds.includes(line.id));
      const source = entryLines.map((line) => line.text).join("\n");
      if ([entry.title, entry.dates, entry.company, entry.location]
        .some((value) => value && !source.includes(value))) return false;
      if (Object.values(entry.fields).some((value) => value && !source.includes(value))) return false;
      if (entry.bullets.some((bullet) => !entryLines.some((line) =>
        line.id === bullet.id && line.text === bullet.text && line.kind === "bullet"))) return false;
    }
  }
  return true;
}

export function reseedStructuredCvIds(cv: StructuredCv): StructuredCv {
  const result = structuredClone(cv);
  for (const [sectionIndex, section] of result.sections.entries()) {
    section.id = stableId("section", section.type, sectionIndex, section.heading);
    const lineIds = new Map<string, string>();
    for (const [lineIndex, line] of section.lines.entries()) {
      const oldLineId = line.id;
      line.id = stableId("line", section.id, lineIndex, line.text);
      lineIds.set(oldLineId, line.id);
    }
    for (const [entryIndex, entry] of section.entries.entries()) {
      entry.id = stableId("entry", section.id, entryIndex, entry.title);
      entry.lineIds = entry.lineIds.map((id) => lineIds.get(id)).filter((id): id is string => Boolean(id));
      entry.bullets = entry.bullets.map((line) => ({
        ...line,
        id: lineIds.get(line.id) ?? stableId("line", section.id, entryIndex, line.text),
      }));
    }
  }
  return result;
}

export function calculateCoverage(sourceText: string, structuredText: string): number {
  const source = normalizeForCoverage(sourceText);
  const structured = normalizeForCoverage(structuredText);
  if (!source) return structured ? 0 : 1;
  if (source === structured) return 1;
  const sourceTokens = source.split(" ");
  const remaining = new Map<string, number>();
  for (const token of structured.split(" ")) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let matched = 0;
  for (const token of sourceTokens) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      remaining.set(token, count - 1);
      matched += 1;
    }
  }
  return matched / Math.max(sourceTokens.length, structured.split(" ").length);
}

export function deriveSuggestionTarget(
  cv: StructuredCv,
  input: { originalText: string; proposedText: string; sourceSnippet?: string },
): SuggestionTarget | null {
  const candidates: Array<{
    section: StructuredCvSection;
    line: StructuredCvLine;
    before: string;
  }> = [];
  for (const section of cv.sections) {
    for (const line of section.lines) {
      const before = locateSourceText(line.text, input.originalText);
      if (before) candidates.push({ section, line, before });
    }
  }
  if (candidates.length !== 1) return null;
  const { section, line, before } = candidates[0];
  const entry = section.entries.find((item) => item.lineIds.includes(line.id));
  if (line.kind === "bullet" && (
    (section.type !== "experience" && section.type !== "projects") ||
    !entry
  )) return null;
  const target: SuggestionTarget = {
    sectionType: section.type,
    sectionSubtype: section.heading,
    operation: "replace",
    before,
    after: input.proposedText,
    ...(entry ? { entryId: entry.id } : {}),
    ...(line.kind === "bullet" ? { bulletId: line.id, field: "bulletText" } : {
      field: section.type === "summary"
        ? "summary"
        : section.type === "coreCompetencies" || section.type === "technicalSkills"
          ? "skills"
          : `line:${line.id}`,
    }),
  };
  return target;
}

export function applySuggestionTarget(cv: StructuredCv, target: SuggestionTarget): boolean {
  if (target.operation !== "replace" || target.before.length === 0 || target.after.length === 0) return false;
  const sections = cv.sections.filter((section) =>
    section.type === target.sectionType &&
    (target.sectionSubtype === undefined || section.heading === target.sectionSubtype));
  if (sections.length !== 1) return false;
  const section = sections[0];
  if (target.field === "summary" && section.type !== "summary") return false;
  if (target.field === "skills" &&
    section.type !== "coreCompetencies" && section.type !== "technicalSkills") return false;
  const entry = target.entryId
    ? section.entries.find((item) => item.id === target.entryId)
    : undefined;
  if (target.entryId && !entry) return false;
  if (target.bulletId && !target.entryId) return false;
  const lineId = target.bulletId ??
    (target.field?.startsWith("line:") ? target.field.slice(5) : undefined);
  const candidates = section.lines.filter((line) =>
    (!lineId || line.id === lineId) &&
    (!target.bulletId || line.id === target.bulletId) &&
    (!target.bulletId || (line.kind === "bullet" && (section.type === "experience" || section.type === "projects"))) &&
    (target.field !== "bulletText" || line.kind === "bullet") &&
    (!entry || entry.lineIds.includes(line.id)) &&
    line.text.split(target.before).length === 2);
  if (candidates.length !== 1) return false;
  const line = candidates[0];
  const replacement = section.type === "summary"
    ? target.after.replace(/\s+/g, " ").trim()
    : section.type === "technicalSkills" || section.type === "coreCompetencies"
      ? target.after.replace(/(?:^|\n)\s*[•▪●◦*-]\s*/g, " | ").replace(/\s+/g, " ").replace(/(?:\s*\|\s*){2,}/g, " | ").trim()
      : line.kind === "bullet"
        ? target.after.replace(/(?:^|\n)\s*[•▪●◦*-]\s*/g, " ").replace(/\s+/g, " ").trim()
        : target.after;
  line.text = line.text.replace(target.before, replacement);
  if (section.type === "summary" || section.type === "technicalSkills" || section.type === "coreCompetencies") {
    line.kind = "paragraph";
  }
  const activeEntry = section.entries.find((item) => item.lineIds.includes(line.id));
  if (activeEntry && activeEntry.lineIds[0] === line.id) {
    const parsed = parseEntryHeading(line.text);
    if (parsed) Object.assign(activeEntry, parsed);
    else activeEntry.title = line.text;
  }
  const projectField = /^(Objective|Technologies|Contribution|Outcome):\s*(.*)$/i.exec(line.text);
  if (activeEntry && projectField) {
    const field = projectField[1].toLocaleLowerCase();
    const key = field[0].toLocaleUpperCase() + field.slice(1) as keyof StructuredCvEntry["fields"];
    activeEntry.fields[key] = projectField[2];
  }
  if (line.kind === "bullet") {
    const bullet = section.entries.flatMap((item) => item.bullets).find((item) => item.id === line.id);
    if (bullet) bullet.text = line.text;
  }
  return true;
}

export function applyAcceptedSuggestions(
  sourceCv: StructuredCv,
  suggestions: TargetedResumeSuggestion[],
): StructuredSuggestionResult {
  let structuredCv = structuredClone(sourceCv);
  const appliedSuggestionIds: string[] = [];
  const needsPlacement: StructuredSuggestionResult["needsPlacement"] = [];
  for (const suggestion of suggestions) {
    if (suggestion.status !== "accepted") continue;
    const derivedTarget = deriveSuggestionTarget(structuredCv, suggestion);
    const targets = [suggestion.target ?? null, derivedTarget].map((target) => {
      if (!target) return null;
      const parsed = suggestionTargetSchema.safeParse(target);
      return parsed.success ? parsed.data : null;
    });
    let applied = false;
    for (const target of targets) {
      if (!target || target.after !== suggestion.proposedText) continue;
      const candidate = structuredClone(structuredCv);
      if (!applySuggestionTarget(candidate, target)) continue;
      structuredCv = candidate;
      applied = true;
      break;
    }
    if (applied) appliedSuggestionIds.push(suggestion.id);
    else needsPlacement.push({
      suggestionId: suggestion.id,
      reason: "The accepted suggestion does not have one unambiguous target in the current CV.",
    });
  }
  return { structuredCv, appliedSuggestionIds, needsPlacement };
}

function structureEntries(section: StructuredCvSection): StructuredCvEntry[] {
  const entries: StructuredCvEntry[] = [];
  let entry: StructuredCvEntry | undefined;
  const startEntry = (line: StructuredCvLine) => {
    entry = {
      id: stableId("entry", section.id, entries.length, line.text),
      title: line.text,
      dates: "",
      company: "",
      location: "",
      fields: {},
      bullets: [],
      lineIds: [line.id],
    };
    entries.push(entry);
    return entry;
  };

  for (const [index, line] of section.lines.entries()) {
    if (line.kind === "bullet") {
      const active = entry ?? startEntry(line);
      if (!active.lineIds.includes(line.id)) active.lineIds.push(line.id);
      active.bullets.push(line);
      continue;
    }
    const parsed = parseEntryHeading(line.text);
    const startsEntry = Boolean(parsed || dateRange.test(line.text) || (index > 0 && line.bold));
    if (startsEntry) {
      const active = startEntry(line);
      if (parsed) {
        active.title = parsed.title;
        active.dates = parsed.dates;
        active.company = parsed.company;
        active.location = parsed.location;
      }
      if (!parsed) active.title = line.text;
    } else if (entry && dateRange.test(line.text)) {
      entry.dates = line.text;
      if (!entry.lineIds.includes(line.id)) entry.lineIds.push(line.id);
    } else if (entry) {
      if (!entry.lineIds.includes(line.id)) entry.lineIds.push(line.id);
    } else {
      startEntry(line);
    }
    const active = entry;
    const projectField = /^(Objective|Technologies|Contribution|Outcome):\s*(.*)$/i.exec(line.text);
    if (active && projectField) {
      const field = projectField[1].toLocaleLowerCase();
      const key = field[0].toLocaleUpperCase() + field.slice(1) as keyof StructuredCvEntry["fields"];
      active.fields[key] = projectField[2];
    }
  }
  return entries;
}

function parseEntryHeading(text: string): {
  title: string;
  dates: string;
  company: string;
  location: string;
} | null {
  const match = /^(.*?)\s+((?:19|20)\d{2}\s*(?:[–—-]|to)\s*(?:present|current|(?:19|20)\d{2}))\s+(.+?)(?:\s*\|\s*(.+))?$/i.exec(text.trim());
  if (!match) return null;
  return {
    title: match[1].trim(),
    dates: match[2].trim(),
    company: match[3].trim(),
    location: match[4]?.trim() ?? "",
  };
}

function locateSourceText(line: string, candidate: string): string | null {
  const value = candidate.trim();
  if (!value) return null;
  const exactIndex = line.indexOf(value);
  if (exactIndex >= 0 && line.indexOf(value, exactIndex + value.length) < 0) return value;
  const parts = value.split(/<[A-Z][A-Z0-9_]*>/g).map((part) => part.trim());
  const anchors = parts.filter((part) => part.length >= 4);
  if (anchors.length === 0) return null;
  const firstIndex = line.indexOf(anchors[0]);
  if (firstIndex < 0 || line.indexOf(anchors[0], firstIndex + 1) >= 0) return null;
  if (anchors.length === 1) {
    const sentenceEnd = line.slice(firstIndex).search(/[.!?](?=\s|$)/);
    if (sentenceEnd < 0) return null;
    return line.slice(firstIndex, firstIndex + sentenceEnd + 1);
  }
  const lastAnchor = anchors[anchors.length - 1];
  const lastIndex = line.indexOf(lastAnchor, firstIndex + anchors[0].length);
  if (lastIndex < 0 || line.indexOf(lastAnchor, lastIndex + 1) >= 0) return null;
  return line.slice(firstIndex, lastIndex + lastAnchor.length);
}

function splitInlineHeadings(
  line: CvSourceLine,
  dictionary: ReadonlyArray<{ label: string; type: CvSectionType; aliases: readonly string[] }>,
): CvSourceLine[] {
  const source = line.text.replace(/\r\n?/g, "\n");
  const matcher = new RegExp(
    `(^|\\s)(${dictionary.flatMap((item) => item.aliases).sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})(?:\\s*\\(CONTINUED\\))?(?=\\s|:|$)`,
    "gi",
  );
  const parts: CvSourceLine[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) !== null) {
    const start = match.index + match[1].length;
    const before = source.slice(cursor, start).trim();
    if (before) parts.push({ ...line, text: before });
    parts.push({ ...line, text: match[2] + (/\(CONTINUED\)/i.test(match[0]) ? " (CONTINUED)" : "") });
    cursor = matcher.lastIndex;
  }
  const after = source.slice(cursor).trim();
  if (after) parts.push({ ...line, text: after });
  return parts.length ? parts : [line];
}

function matchHeading(
  text: string,
  dictionary: ReadonlyArray<{ label: string; type: CvSectionType; aliases: readonly string[] }>,
): { label: string; type: CvSectionType } | null {
  const normalized = normalizeHeading(text);
  for (const item of dictionary) {
    if (item.aliases.some((alias) => normalizeHeading(alias) === normalized)) {
      return { label: item.label, type: item.type };
    }
  }
  const continued = normalized.replace(/\s+CONTINUED$/, "");
  for (const item of dictionary) {
    if (item.aliases.some((alias) => normalizeHeading(alias) === continued)) {
      return { label: item.label, type: item.type };
    }
  }
  return null;
}

function detectCustomHeading(text: string): { label: string; type: CvSectionType } | null {
  const candidate = text.replace(/:$/, "").trim();
  if (candidate.length > 80 || candidate.split(/\s+/).length > 8) return null;
  if (!/[A-Z]/.test(candidate) || candidate !== candidate.toLocaleUpperCase()) return null;
  if (/^(?:19|20)\d{2}\b/.test(candidate)) return null;
  return { label: candidate.replace(/\s*\(CONTINUED\)\s*$/i, "").trim(), type: "custom" };
}

function mergeContinuedSections(sections: StructuredCvSection[]): StructuredCvSection[] {
  const result: StructuredCvSection[] = [];
  for (const section of sections) {
    const previous = result[result.length - 1];
    if (previous && previous.type === section.type && normalizeHeading(previous.heading) === normalizeHeading(section.heading)) {
      previous.sourceHeadings.push(...section.sourceHeadings);
      previous.lines.push(...section.lines);
    } else {
      result.push(section);
    }
  }
  return result;
}

function createSection(type: CvSectionType, heading: string, sourceHeading: string, index: number): StructuredCvSection {
  return {
    id: stableId("section", type, index, heading),
    type,
    heading,
    sourceHeadings: sourceHeading ? [sourceHeading] : [],
    lines: [],
    entries: [],
  };
}

function normalizeHeading(value: string): string {
  return value.replace(/\s*\(CONTINUED\)\s*$/i, "").replace(/:+$/, "").trim().toLocaleUpperCase();
}

function normalizeForCoverage(value: string): string {
  return value.replace(/\u0000/g, " ").replace(/^[ \t]*(?:[•▪●◦*-])\s+/gm, "")
    .replace(/[•▪●◦]\s*/g, "")
    .replace(/^[A-Z][A-Z &/,-]*\s+\(CONTINUED\)\s*$/gim, "")
    .replace(/\(CONTINUED\)/gi, "")
    .replace(/\s+/g, " ").trim();
}

function structuredCvSourceText(sections: StructuredCvSection[]): string {
  return sections.flatMap((section) => [
    ...(section.sourceHeadings.length ? [section.sourceHeadings[0]] : []),
    ...section.lines.map((line) => line.text),
  ]).join("\n");
}

function stableId(prefix: string, parent: string, index: number, value: string): string {
  const digest = createHash("sha256").update(`${parent}\0${index}\0${value}`).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
