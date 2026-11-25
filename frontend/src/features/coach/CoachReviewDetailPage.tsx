import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  User,
  Briefcase,
  FileText,
  Download,
  ExternalLink,
  Loader2,
  XCircle,
  Edit3,
} from "lucide-react";
import {
  claimReview,
  decideReview,
  getCoachReviewDetails,
  getReviewResumeFile,
  releaseReview,
  type CoachReviewDetails,
} from "../../api/client";
import CvDrawer from "./CvDrawer";
import JobDescriptionDrawer from "./JobDescriptionDrawer";

interface CoachReviewDetailPageProps {
  token: string;
  coachEmail: string;
}

export default function CoachReviewDetailPage({
  token,
}: CoachReviewDetailPageProps) {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();

  const [details, setDetails] = useState<CoachReviewDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Decision form states
  const [reason, setReason] = useState("");
  const [modifiedOutput, setModifiedOutput] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);

  // Drawers
  const [cvDrawerOpen, setCvDrawerOpen] = useState(false);
  const [jobDrawerOpen, setJobDrawerOpen] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState(false);

  useEffect(() => {
    if (!reviewId) return;
    let active = true;
    setLoading(true);
    setError("");

    // Claim first, then fetch details
    claimReview(token, reviewId)
      .catch(() => {}) // if already claimed by me or in review, ignore
      .then(() => getCoachReviewDetails(token, reviewId))
      .then((res) => {
        if (!active) return;
        setDetails(res);
        setModifiedOutput(defaultModifiedOutput(res.target));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load review details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, reviewId]);

  async function handleDownloadOriginal() {
    if (!details?.review.id) return;
    setDownloadingFile(true);
    try {
      const blob = await getReviewResumeFile(token, details.review.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = details.resume?.fileName ?? "resume";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to download original CV.",
        error: true,
      });
    } finally {
      setDownloadingFile(false);
    }
  }

  async function handleDecision(decision: "approve" | "modify" | "reject") {
    if (!reviewId || !reason.trim()) {
      setNotice({ message: "A written reason is required before submitting your decision.", error: true });
      return;
    }
    if (decision === "modify" && !modifiedOutput.trim()) {
      setNotice({ message: "Corrected output is required when modifying a review.", error: true });
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      await decideReview(token, reviewId, decision, reason, {
        ...(decision === "modify" ? { modifiedOutput: modifiedOutput.trim() } : {}),
        recommendations: recommendations
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 8),
        ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
      });

      navigate("/coach/reviews", {
        state: { message: `Review ${decision}d successfully.` },
      });
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to submit review decision.",
        error: true,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRelease() {
    if (!reviewId) return;
    setSubmitting(true);
    try {
      await releaseReview(token, reviewId);
      navigate("/coach/queue");
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to release review.",
        error: true,
      });
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        <p className="text-sm">Claiming and loading review context…</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="p-6 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-2xl" role="alert">
          <h2 className="text-lg font-bold mb-2">Could not open review</h2>
          <p className="text-sm">{error || "Review not found or access restricted."}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/coach/queue")}
          className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Review Queue
        </button>
      </div>
    );
  }

  const { review, candidate, resume, job, target } = details;

  return (
    <div className="space-y-8 pb-16 max-w-6xl">
      {/* Back navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => navigate("/coach/queue")}
            className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Queue
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight capitalize">
              {review.targetType.replace("_", " ")} Review
            </h1>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                review.riskLevel === "high"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : review.riskLevel === "medium"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {review.riskLevel} risk
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={handleRelease}
            className="px-3.5 py-2 bg-[#153252] hover:bg-[#1c416a] border border-[#1e4168] text-slate-300 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
          >
            Release claim
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`p-4 rounded-2xl text-sm border ${
            notice.error
              ? "bg-rose-950/80 border-rose-800 text-rose-200"
              : "bg-emerald-950/80 border-emerald-800 text-emerald-200"
          }`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.message}
        </div>
      )}

      {/* Grid: Context Overview & Quick Drawers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Candidate Account Info */}
        <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <User className="w-4 h-4 text-blue-400" />
            Candidate Account
          </div>
          <div className="space-y-1.5 text-xs">
            <p className="text-white font-semibold text-sm">{candidate.displayName}</p>
            <p className="text-slate-400">{candidate.email}</p>
            <p className="text-slate-500">ID: {candidate.id}</p>
            <p className="text-slate-400 pt-2">
              Registered: {new Date(candidate.registeredAt).toLocaleDateString()}
            </p>
          </div>
          {review.flagReasons && review.flagReasons.length > 0 && (
            <div className="pt-3 border-t border-[#1e4168] space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Flag reason</p>
              <p className="text-xs text-amber-200">{review.flagReasons.join("; ")}</p>
            </div>
          )}
        </div>

        {/* CV Document Card */}
        <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <FileText className="w-4 h-4 text-blue-400" />
              Candidate CV
            </div>
            {resume && (
              <button
                type="button"
                disabled={downloadingFile}
                onClick={handleDownloadOriginal}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                title="Download original CV"
              >
                <Download className="w-3.5 h-3.5" />
                Original
              </button>
            )}
          </div>
          {resume ? (
            <div className="space-y-2 text-xs">
              <p className="text-white font-semibold truncate">{resume.title || resume.fileName}</p>
              <p className="text-slate-400">File: {resume.fileName}</p>
              <p className="text-slate-400">
                Uploaded: {new Date(resume.createdAt).toLocaleDateString()}
              </p>
              <button
                type="button"
                onClick={() => setCvDrawerOpen(true)}
                className="mt-3 w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>View Full CV & Citations</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">No CV attached to this review.</p>
          )}
        </div>

        {/* Job Description Card */}
        <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <Briefcase className="w-4 h-4 text-blue-400" />
            Target Job Description
          </div>
          {job ? (
            <div className="space-y-2 text-xs">
              <p className="text-white font-semibold truncate">{job.title}</p>
              <p className="text-slate-400">{job.company || "Company not specified"}</p>
              <p className="text-slate-400">
                Added: {new Date(job.createdAt).toLocaleDateString()}
              </p>
              <button
                type="button"
                onClick={() => setJobDrawerOpen(true)}
                className="mt-3 w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>View Full Job Description</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">No target job attached.</p>
          )}
        </div>
      </div>

      {/* AI Output Under Review */}
      <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          AI Output Under Review
        </h2>

        {target.type === "job_match" && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-slate-300">Indicative Match Score:</span>
              <span className="text-lg font-extrabold text-blue-400">{target.score}%</span>
            </div>
            <p className="text-slate-300 italic">{target.disclaimer}</p>

            <div className="space-y-2 pt-2">
              <h3 className="font-bold text-white text-sm">Skill Requirements Analysis</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {target.skillResults.map((skill, idx) => (
                  <div
                    key={`${skill.name}-${idx}`}
                    className="p-3 bg-[#0a1c30] rounded-xl border border-[#1e4168] space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{skill.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          skill.status === "matched"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        {skill.status}
                      </span>
                    </div>
                    {skill.evidenceSnippet && (
                      <p className="text-slate-400 italic text-[11px] bg-[#112438] p-2 rounded border border-[#183654]">
                        "{skill.evidenceSnippet}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {target.type === "resume_suggestion" && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-300">
              <strong className="text-white">Reason:</strong> {target.reason}
            </p>
            {target.sourceSnippet && (
              <div className="space-y-1">
                <span className="text-slate-400 font-semibold">Source Evidence:</span>
                <blockquote className="p-3 bg-[#0a1c30] rounded-xl border border-[#1e4168] text-slate-300 italic">
                  {target.sourceSnippet}
                </blockquote>
              </div>
            )}
            {target.originalText && (
              <div className="space-y-1">
                <span className="text-slate-400 font-semibold">Original CV Text:</span>
                <blockquote className="p-3 bg-[#0a1c30] rounded-xl border border-[#1e4168] text-slate-300">
                  {target.originalText}
                </blockquote>
              </div>
            )}
          </div>
        )}

        {target.type === "interview_evaluation" && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-300">
              <strong className="text-white">Overall Score:</strong> {target.overallScore}%
            </p>
            {target.strengths.length > 0 && (
              <div>
                <strong className="text-white">Strengths:</strong>
                <ul className="list-disc list-inside text-slate-300 mt-1">
                  {target.strengths.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {target.improvements.length > 0 && (
              <div>
                <strong className="text-white">Improvements:</strong>
                <ul className="list-disc list-inside text-slate-300 mt-1">
                  {target.improvements.map((imp, idx) => (
                    <li key={idx}>{imp}</li>
                  ))}
                </ul>
              </div>
            )}
            {target.dimensions.length > 0 && (
              <div className="space-y-2 pt-2">
                <strong className="text-white">Rubric Dimensions:</strong>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {target.dimensions.map((dim, idx) => (
                    <div key={idx} className="p-3 bg-[#0a1c30] rounded-xl border border-[#1e4168]">
                      <div className="flex justify-between items-center text-white font-semibold">
                        <span>{dim.dimension}</span>
                        <span className="text-blue-400">{dim.score}/4</span>
                      </div>
                      <p className="text-slate-400 text-[11px] mt-1">{dim.feedback}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {target.answers.length > 0 && (
              <div className="space-y-2 pt-2">
                <strong className="text-white">Questions & Answers:</strong>
                {target.answers.map((qa, idx) => (
                  <div key={idx} className="p-3 bg-[#0a1c30] rounded-xl border border-[#1e4168] space-y-1">
                    <p className="text-slate-200 font-semibold">{qa.question}</p>
                    <p className="text-slate-400 italic">"{qa.answer}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Decision Form */}
      <div className="bg-[#153252] border border-[#1e4168] rounded-2xl p-6 shadow-xl space-y-6">
        <div className="border-b border-[#1e4168] pb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-blue-400" />
            Coach Decision Form
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Provide your expert coaching assessment. A written reason is recorded for every decision.
          </p>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label htmlFor="reason" className="block text-white font-semibold mb-1.5">
              Written Reason <span className="text-rose-400">*</span>
            </label>
            <textarea
              id="reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the rationale for your review decision (required)…"
              className="w-full bg-[#0a1c30] border border-[#1e4168] rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label htmlFor="modified-output" className="block text-white font-semibold mb-1.5">
              Corrected Output / Recommendation <span className="text-slate-400 font-normal">(Required if choosing Modify)</span>
            </label>
            <textarea
              id="modified-output"
              rows={4}
              value={modifiedOutput}
              onChange={(e) => setModifiedOutput(e.target.value)}
              placeholder="Enter corrected match evaluation, recommendation text, or revised output…"
              className="w-full bg-[#0a1c30] border border-[#1e4168] rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="recommendations" className="block text-white font-semibold mb-1.5">
              Actionable Recommendations for Candidate <span className="text-slate-400 font-normal">(Optional, one per line, up to 8)</span>
            </label>
            <textarea
              id="recommendations"
              rows={3}
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              placeholder="e.g. Add quantification of cloud metrics in AWS role&#10;Include Docker Kubernetes deployment experience"
              className="w-full bg-[#0a1c30] border border-[#1e4168] rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="internal-note" className="block text-white font-semibold mb-1.5">
              Internal Note <span className="text-slate-400 font-normal">(Optional, private to coaches and admins)</span>
            </label>
            <textarea
              id="internal-note"
              rows={2}
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              placeholder="Internal coaching observation or QA notes…"
              className="w-full bg-[#0a1c30] border border-[#1e4168] rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-[#1e4168]">
          <button
            type="button"
            disabled={submitting || !reason.trim()}
            onClick={() => handleDecision("approve")}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <CheckCircle2 className="w-4 h-4" />
            Approve Review
          </button>

          <button
            type="button"
            disabled={submitting || !reason.trim() || !modifiedOutput.trim()}
            onClick={() => handleDecision("modify")}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <Edit3 className="w-4 h-4" />
            Submit with Modifications
          </button>

          <button
            type="button"
            disabled={submitting || !reason.trim()}
            onClick={() => handleDecision("reject")}
            className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 transition-all focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            <XCircle className="w-4 h-4" />
            Reject Output
          </button>
        </div>
      </div>

      {/* CV Drawer */}
      {cvDrawerOpen && (
        <CvDrawer
          isOpen={cvDrawerOpen}
          onClose={() => setCvDrawerOpen(false)}
          token={token}
          reviewId={review.id}
        />
      )}

      {/* Job Description Drawer */}
      {jobDrawerOpen && (
        <JobDescriptionDrawer
          isOpen={jobDrawerOpen}
          onClose={() => setJobDrawerOpen(false)}
          token={token}
          reviewId={review.id}
        />
      )}
    </div>
  );
}

function defaultModifiedOutput(target: CoachReviewDetails["target"]): string {
  if (target.type === "job_match") {
    return target.reviewedOutput || `Verified match score: ${target.score}%. Coach approved evaluation.`;
  }
  if (target.type === "resume_suggestion") {
    return target.proposedText || "";
  }
  return "";
}
