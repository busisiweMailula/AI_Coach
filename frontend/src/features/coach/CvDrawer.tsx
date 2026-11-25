import { useEffect, useRef, useState } from "react";
import { X, Download, ExternalLink, AlertTriangle, FileText, Loader2 } from "lucide-react";
import {
  getCoachReviewDetails,
  getReviewResumeFile,
  recordReviewDrawerViewAudit,
  type CoachReviewDetails,
} from "../../api/client";

interface CvDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  reviewId: string | null;
  token: string;
  onOpenFullReview?: (reviewId: string) => void;
}

export default function CvDrawer({
  isOpen,
  onClose,
  reviewId,
  token,
  onOpenFullReview,
}: CvDrawerProps) {
  const [details, setDetails] = useState<CoachReviewDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  // Focus management & audit logging when opened
  useEffect(() => {
    if (!isOpen || !reviewId) return;

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
    setLoading(true);
    setError("");
    setDetails(null);

    // Audit log drawer view
    void recordReviewDrawerViewAudit(token, reviewId, "cv").catch(() => {});

    // Fetch full review details for full CV text and citations
    void getCoachReviewDetails(token, reviewId)
      .then((data) => {
        setDetails(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load CV details.");
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      previouslyFocusedElement.current?.focus();
    };
  }, [isOpen, reviewId, token]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Trap focus
  useEffect(() => {
    if (!isOpen || !drawerRef.current) return;
    const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }, [isOpen, loading]);

  if (!isOpen) return null;

  async function handleDownloadOriginal() {
    if (!reviewId || downloading) return;
    setDownloading(true);
    try {
      const blob = await getReviewResumeFile(token, reviewId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = details?.resume?.fileName || "resume.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Could not download original file.");
    } finally {
      setDownloading(false);
    }
  }

  // Extract cited evidence snippets from target
  const citedEvidence: string[] = [];
  const notFoundEvidence: string[] = [];
  if (details?.target) {
    if (details.target.type === "job_match") {
      for (const skill of details.target.skillResults) {
        if (skill.evidenceSnippet) {
          const cvText = (details.resume?.extractedText || "").toLowerCase();
          if (cvText.includes(skill.evidenceSnippet.toLowerCase())) {
            citedEvidence.push(skill.evidenceSnippet);
          } else {
            notFoundEvidence.push(skill.evidenceSnippet);
          }
        }
      }
    } else if (details.target.type === "resume_suggestion") {
      if (details.target.originalText) {
        citedEvidence.push(details.target.originalText);
      }
    }
  }

  // Helper to highlight cited passages in text
  function renderHighlightedText(text: string) {
    if (!citedEvidence.length) return text;

    // Build regex of cited snippets
    const escaped = citedEvidence
      .filter((s) => s.length > 2)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!escaped.length) return text;

    const regex = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, idx) => {
      const isMatch = citedEvidence.some((c) => c.toLowerCase() === part.toLowerCase());
      if (isMatch) {
        return (
          <mark
            key={idx}
            className="bg-amber-200 text-amber-900 px-1 py-0.5 rounded font-medium shadow-sm border border-amber-300"
            title="Cited by AI as evidence"
          >
            {part}
          </mark>
        );
      }
      return part;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="cv-drawer-title">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} aria-hidden="true" />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="relative w-full max-w-2xl bg-white text-slate-800 shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-right duration-200"
      >
        {/* Drawer header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="cv-drawer-title" className="text-base font-bold text-slate-900 truncate">
                {details?.resume?.title || details?.resume?.fileName || "Curriculum Vitae"}
              </h2>
              <p className="text-xs text-slate-500">
                Uploaded {details?.resume?.createdAt ? new Date(details.resume.createdAt).toLocaleDateString() : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors shadow-sm disabled:opacity-50"
              onClick={() => void handleDownloadOriginal()}
              disabled={downloading || !details?.resume}
              title="Download original file"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>Original</span>
            </button>
            <button
              type="button"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              onClick={onClose}
              aria-label="Close CV drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Citations legend bar */}
        {citedEvidence.length > 0 && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0 inline-block" />
            <span>Passages highlighted in yellow were cited as matching evidence by the AI.</span>
          </div>
        )}

        {/* Not found citations alert box */}
        {notFoundEvidence.length > 0 && (
          <div className="mx-5 my-3 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
            <div className="flex items-center gap-1.5 font-bold mb-1 text-rose-900">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Cited evidence not found in CV:</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-rose-700 pl-1">
              {notFoundEvidence.map((quote, idx) => (
                <li key={idx} className="font-mono text-[11px]">
                  "{quote}"
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Drawer body - independent scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium">Loading full CV…</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
              {error}
            </div>
          ) : !details?.resume ? (
            <p className="text-sm text-slate-500">No CV content available for this review.</p>
          ) : details.resume.structuredCv ? (
            /* Structured section-by-section rendering */
            <div className="space-y-6 font-sans">
              {/* Header profile */}
              <div className="border-b border-slate-200 pb-4">
                <h1 className="text-2xl font-black text-slate-900">
                  {details.resume.structuredCv.header.name || "Candidate Name"}
                </h1>
                {details.resume.structuredCv.header.headline && (
                  <p className="text-sm font-semibold text-blue-700 mt-1">
                    {details.resume.structuredCv.header.headline}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
                  {details.resume.structuredCv.header.email && <span>{details.resume.structuredCv.header.email}</span>}
                  {details.resume.structuredCv.header.phone && <span>{details.resume.structuredCv.header.phone}</span>}
                  {details.resume.structuredCv.header.location && <span>{details.resume.structuredCv.header.location}</span>}
                </div>
              </div>

              {/* Sections */}
              {details.resume.structuredCv.sections.map((section) => (
                <section key={section.id} className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-200">
                    {section.heading}
                  </h3>

                  {/* Paragraphs */}
                  {section.paragraphs.length > 0 && (
                    <div className="space-y-1.5 text-sm text-slate-700 leading-relaxed">
                      {section.paragraphs.map((p) => (
                        <p key={p.id}>{renderHighlightedText(p.text)}</p>
                      ))}
                    </div>
                  )}

                  {/* Entries (Experience, Education, Projects) */}
                  {section.entries.length > 0 && (
                    <div className="space-y-4">
                      {section.entries.map((entry) => (
                        <div key={entry.id} className="space-y-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-semibold text-slate-900 text-sm">
                              {renderHighlightedText(entry.title || "Role")}
                              {entry.company && <span className="font-normal text-slate-600"> · {renderHighlightedText(entry.company)}</span>}
                            </span>
                            {entry.dates && <span className="text-xs font-medium text-slate-400">{entry.dates}</span>}
                          </div>
                          {entry.location && <p className="text-xs text-slate-500">{entry.location}</p>}
                          {entry.lines.length > 0 && (
                            <ul className="list-disc list-outside ml-4 space-y-1 text-sm text-slate-700">
                              {entry.lines.map((line) => (
                                <li key={line.id}>{renderHighlightedText(line.text)}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Skills/Competencies groups */}
                  {section.groups.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {section.groups.map((group) => (
                        <span
                          key={group.id}
                          className="px-2.5 py-1 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg border border-slate-200"
                        >
                          {group.label && <strong className="font-semibold">{group.label}: </strong>}
                          {renderHighlightedText(group.value)}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            /* Fallback raw text */
            <div className="whitespace-pre-wrap font-mono text-xs text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">
              {renderHighlightedText(details.resume.extractedText)}
            </div>
          )}
        </div>

        {/* Drawer footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 flex-shrink-0">
          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
            onClick={onClose}
          >
            Close
          </button>
          {reviewId && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-md transition-colors"
              onClick={() => {
                onClose();
                onOpenFullReview?.(reviewId);
              }}
            >
              <span>Open full review</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
