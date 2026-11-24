import { parseResumeSections } from "./resume-format";
import type { StructuredCv } from "../../api/client";

interface Props {
  structuredCv?: StructuredCv;
  content?: string;
  changedSectionIds?: string[];
  onChange?: (cv: StructuredCv) => void;
}

export default function ResumePreview({ structuredCv, content, changedSectionIds = [], onChange }: Props) {
  if (!structuredCv) return <LegacyPreview content={content ?? ""} />;
  const cv = structuredCv;
  const changed = new Set(changedSectionIds);

  function updateHeader(field: keyof StructuredCv["header"], value: string) {
    if (!onChange) return;
    const updated = structuredClone(cv);
    if (field === "links") updated.header.links = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    else updated.header[field] = value;
    onChange(updated);
  }

  function updateSection(sectionId: string, value: string, lineId?: string) {
    if (!onChange) return;
    const updated = structuredClone(cv);
    const section = updated.sections.find((item) => item.id === sectionId);
    if (!section) return;
    if (lineId) {
      const line = section.lines.find((item) => item.id === lineId);
      if (!line) return;
      line.text = value;
      for (const entry of section.entries) {
        const bullet = entry.bullets.find((item) => item.id === lineId);
        if (bullet) bullet.text = value;
      }
    } else {
      section.heading = value;
    }
    onChange(updated);
  }

  const contact = [
    structuredCv.header.phone,
    structuredCv.header.email,
    structuredCv.header.location,
    ...structuredCv.header.links,
  ].filter(Boolean).join(" | ");

  return (
    <article className="resume-preview" aria-label="Editable structured CV preview">
      <header className="resume-preview-header">
        <input aria-label="Name" className="resume-preview-title" value={cv.header.name}
          onChange={(event) => updateHeader("name", event.target.value)} />
        <input aria-label="Headline" value={cv.header.headline}
          onChange={(event) => updateHeader("headline", event.target.value)} />
        <input aria-label="Phone" value={cv.header.phone}
          onChange={(event) => updateHeader("phone", event.target.value)} />
        <input aria-label="Email" value={cv.header.email}
          onChange={(event) => updateHeader("email", event.target.value)} />
        <input aria-label="Location" value={cv.header.location}
          onChange={(event) => updateHeader("location", event.target.value)} />
        <textarea aria-label="Links" rows={Math.max(1, cv.header.links.length)}
          value={cv.header.links.join("\n")}
          onChange={(event) => updateHeader("links", event.target.value)} />
        {contact && <p className="resume-preview-contact">{contact}</p>}
      </header>
      {cv.sections.map((section) => (
        <section
          className={`resume-preview-section${changed.has(section.id) ? " changed" : ""}`}
          key={section.id}
        >
          <input
            aria-label={`${section.heading || "Custom"} section heading`}
            className="resume-preview-heading"
            value={section.heading}
            onChange={(event) => updateSection(section.id, event.target.value)}
          />
          {section.lines.map((line) => (
            <label className={`resume-preview-line${line.kind === "bullet" ? " resume-preview-bullet" : ""}`} key={line.id}>
              <textarea
                aria-label={`Edit ${section.heading || "opening"} text`}
                rows={Math.max(1, Math.ceil(line.text.length / 90))}
                value={line.text}
                onChange={(event) => updateSection(section.id, event.target.value, line.id)}
              />
            </label>
          ))}
        </section>
      ))}
    </article>
  );
}

function LegacyPreview({ content }: { content: string }) {
  const sections = parseResumeSections(content);
  let firstLine = true;
  return (
    <article className="resume-preview" aria-label="Submitted CV draft">
      {sections.map((section, sectionIndex) => (
        <section className="resume-preview-section" key={`${section.heading ?? "header"}-${sectionIndex}`}>
          {section.heading && <h4 className="resume-preview-heading">{section.heading}</h4>}
          {section.lines.map((line, lineIndex) => {
            const bullet = line.match(/^(?:[-*•▪●])\s+(.*)$/);
            if (bullet) return <p className="resume-preview-bullet" key={`${sectionIndex}-${lineIndex}`}>{bullet[1]}</p>;
            const className = firstLine ? "resume-preview-title" : undefined;
            firstLine = false;
            return <p className={className} key={`${sectionIndex}-${lineIndex}`}>{line}</p>;
          })}
        </section>
      ))}
    </article>
  );
}
