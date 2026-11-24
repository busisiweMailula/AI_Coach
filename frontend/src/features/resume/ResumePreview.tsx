import { parseResumeSections } from "./resume-format";

export default function ResumePreview({ content }: { content: string }) {
  const sections = parseResumeSections(content);
  let firstLine = true;

  return (
    <article className="resume-preview" aria-label="Formatted CV preview">
      {sections.map((section, sectionIndex) => (
        <section className="resume-preview-section" key={`${section.heading ?? "header"}-${sectionIndex}`}>
          {section.heading && <h4 className="resume-preview-heading">{section.heading}</h4>}
          {section.lines.map((line, lineIndex) => {
            const bullet = line.match(/^(?:[-*•▪●])\s+(.*)$/);
            if (bullet) {
              return <p className="resume-preview-bullet" key={`${sectionIndex}-${lineIndex}`}>{bullet[1]}</p>;
            }

            const className = firstLine ? "resume-preview-title" : undefined;
            firstLine = false;
            return <p className={className} key={`${sectionIndex}-${lineIndex}`}>{line}</p>;
          })}
        </section>
      ))}
    </article>
  );
}
