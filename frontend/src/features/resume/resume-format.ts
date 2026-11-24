export interface ResumeSection {
  heading: string | null;
  lines: string[];
}

const sectionHeadings = [
  "PROFESSIONAL SUMMARY",
  "PROFESSIONAL QUALIFICATIONS",
  "CAREER SUMMARY",
  "CAREER HIGHLIGHTS",
  "CORE COMPETENCIES",
  "PROFESSIONAL EXPERIENCE",
  "EMPLOYMENT EXPERIENCE",
  "WORK EXPERIENCE",
  "EMPLOYMENT HISTORY",
  "PROJECT EXPERIENCE",
  "TECHNICAL PROJECTS",
  "TECHNICAL SKILLS",
  "KEY SKILLS",
  "KEY ACHIEVEMENTS",
  "CAREER OBJECTIVE",
  "CAREER INTERESTS",
  "ACADEMIC BACKGROUND",
  "VOLUNTEER EXPERIENCE",
  "PROFESSIONAL DEVELOPMENT",
  "ADDITIONAL INFORMATION",
  "PERSONAL DETAILS",
  "CONTACT INFORMATION",
  "CONTACT DETAILS",
  "ACCEPTED CV UPDATES",
  "CERTIFICATIONS",
  "ACHIEVEMENTS",
  "QUALIFICATIONS",
  "EDUCATION",
  "EXPERIENCE",
  "PROJECTS",
  "SKILLS",
  "SUMMARY",
  "PROFILE",
  "OBJECTIVE",
  "INTERESTS",
  "LANGUAGES",
  "AWARDS",
  "TRAINING",
  "REFERENCES",
  "PUBLICATIONS",
  "CONTACT",
].sort((left, right) => right.length - left.length);

const escapedHeadings = sectionHeadings.map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const inlineHeadingPattern = new RegExp(`(^|[\\s|])(${escapedHeadings.join("|")})(?=\\s|:|$)`, "gi");

export function parseResumeSections(content: string): ResumeSection[] {
  const sections: ResumeSection[] = [{ heading: null, lines: [] }];
  const sourceLines = content.replace(/\r\n?/g, "\n").split("\n");

  for (const sourceLine of sourceLines) {
    for (const segment of splitAtInlineHeadings(sourceLine)) {
      const text = segment.text.trim();
      if (!text) continue;
      if (segment.heading) {
        sections.push({ heading: text.replace(/:$/, ""), lines: [] });
      } else {
        sections[sections.length - 1].lines.push(text);
      }
    }
  }

  return sections.filter((section) => section.heading !== null || section.lines.length > 0);
}

function splitAtInlineHeadings(line: string): Array<{ text: string; heading: boolean }> {
  const segments: Array<{ text: string; heading: boolean }> = [];
  const standaloneHeading = line.trim().replace(/:$/, "").toLowerCase();
  const matcher = new RegExp(inlineHeadingPattern.source, "gi");
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(line)) !== null) {
    const headingStart = match.index + match[1].length;
    const headingText = match[2];
    const isStandalone = standaloneHeading === headingText.toLowerCase();
    if (!isStandalone && headingText !== headingText.toUpperCase()) continue;

    if (headingStart > cursor) segments.push({ text: line.slice(cursor, headingStart), heading: false });
    const headingEnd = headingStart + headingText.length;
    segments.push({ text: headingText, heading: true });
    cursor = headingEnd;
    while (cursor < line.length && (line[cursor] === ":" || /\s/.test(line[cursor]))) cursor += 1;
    matcher.lastIndex = cursor;
  }

  if (cursor < line.length) segments.push({ text: line.slice(cursor), heading: false });
  if (segments.length === 0 && line.trim()) segments.push({ text: line, heading: false });
  return segments;
}
