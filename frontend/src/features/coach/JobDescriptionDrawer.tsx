import { useEffect, useRef, useState } from "react";
import { X, Briefcase, ExternalLink, Loader2 } from "lucide-react";
import {
  getCoachReviewDetails,
  recordReviewDrawerViewAudit,
  type CoachReviewDetails,
} from "../../api/client";

interface JobDescriptionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  reviewId: string | null;
  token: string;
  onOpenFullReview?: (reviewId: string) => void;
}

export default function JobDescriptionDrawer({
  isOpen,
  onClose,
  reviewId,
  token,
  onOpenFullReview,
}: JobDescriptionDrawerProps) {
  const [details, setDetails] = useState<CoachReviewDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
    void recordReviewDrawerViewAudit(token, reviewId, "job_description").catch(() => {});

    // Fetch review details for job content
    void getCoachReviewDetails(token, reviewId)
      .then((data) => {
        setDetails(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load job description.");
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

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-drawer-title"
    >
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
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center flex-shrink-0 font-bold">
              <Briefcase className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="job-drawer-title" className="text-base font-bold text-slate-900 truncate">
                {details?.job?.title || "Job Description"}
              </h2>
              <p className="text-xs text-slate-500">
                {details?.job?.createdAt ? `Added ${new Date(details.job.createdAt).toLocaleDateString()}` : "Target Role"}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            onClick={onClose}
            aria-label="Close job description drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer body - independent scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              <p className="text-sm font-medium">Loading job description…</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
              {error}
            </div>
          ) : !details?.job ? (
            <p className="text-sm text-slate-500">No job description attached to this review.</p>
          ) : (
            <div className="space-y-6">
              {/* Role title and metadata banner */}
              <div className="p-4 rounded-xl bg-purple-50/60 border border-purple-100 space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-800">Target Role</span>
                <h3 className="text-lg font-bold text-slate-900">{details.job.title}</h3>
                {details.job.company && <p className="text-xs text-slate-600 font-medium">Company: {details.job.company}</p>}
              </div>

              {/* Parsed requirements / skills */}
              {details.target && details.target.type === "job_match" && details.target.skillResults.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-200">
                    Parsed Skills & Requirements
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {details.target.skillResults.map((skill, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="font-semibold text-slate-800">{skill.name}</div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                            skill.status === "matched"
                              ? "bg-emerald-100 text-emerald-800"
                              : skill.status === "missing"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {skill.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full raw job description text */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-200">
                  Full Job Description Text
                </h4>
                <div className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">
                  {details.job.text || "No full text provided."}
                </div>
              </div>
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
