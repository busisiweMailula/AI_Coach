import { useEffect, useState } from "react";
import ResumePreview from "../resume/ResumePreview";
import {
  ApiError,
  decideReview,
  getCoachReviewDetails,
  getPendingReviews,
  getCoachReviewVideo,
  type CoachReviewDetails,
  type ReviewItem,
} from "../../api/client";

interface CoachReviewPageProps {
  token: string;
}

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  return value.toFixed(2);
}

export default function CoachReviewPage({ token }: CoachReviewPageProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<CoachReviewDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [editedText, setEditedText] = useState("");
  const [coachFeedback, setCoachFeedback] = useState("");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [videoSource, setVideoSource] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice(null);
    void getPendingReviews(token).then((result) => {
      if (active) setItems(result.items);
    }).catch((error: unknown) => {
      if (active) setNotice({ message: errorMessage(error), error: true });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refreshKey, token]);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetails(null);
    setNotice(null);
    void getCoachReviewDetails(token, selectedId).then((result) => {
      if (active) {
        setDetails(result);
        setEditedText(result.target.type === "resume_suggestion" ? result.target.proposedText : "");
      }
    }).catch((error: unknown) => {
      if (active) setNotice({ message: errorMessage(error), error: true });
    }).finally(() => {
      if (active) setDetailLoading(false);
    });
    return () => {
      active = false;
    };
  }, [selectedId, token]);

  useEffect(() => {
    const videoUrl = details?.review.videoUrl;
    if (!videoUrl) {
      setVideoSource(null);
      setVideoLoading(false);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;
    setVideoSource(null);
    setVideoLoading(true);
    void getCoachReviewVideo(token, videoUrl).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setVideoSource(objectUrl);
    }).catch((error: unknown) => {
      if (active) setNotice({ message: errorMessage(error), error: true });
    }).finally(() => {
      if (active) setVideoLoading(false);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [details?.review.videoUrl, token]);

  async function submitDecision(decision: "approve" | "edit" | "reject") {
    if (!selectedId || !reason.trim()) {
      setNotice({ message: "Add an internal decision reason before submitting.", error: true });
      return;
    }
    if (decision === "edit" && !editedText.trim()) {
      setNotice({ message: "Provide the edited recommendation before approving it.", error: true });
      return;
    }
    if (details?.target.type === "interview_evaluation" && !coachFeedback.trim()) {
      setNotice({ message: "Write coaching feedback for the candidate before submitting.", error: true });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      await decideReview(
        token,
        selectedId,
        decision,
        reason,
        decision === "edit" ? editedText : undefined,
        coachFeedback.trim() || undefined,
      );
      setItems((current) => current.filter((item) => item.id !== selectedId));
      setSelectedId("");
      setDetails(null);
      setReason("");
      setCoachFeedback("");
      setNotice({ message: "Review decision saved and feedback sent to candidate.", error: false });
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setSubmitting(false);
    }
  }

  const interviewReviews = items.filter((item) => item.targetType === "interview_evaluation").length;
  const resumeReviews = items.filter((item) =>
    item.targetType === "resume_draft" || item.targetType === "resume_suggestion",
  ).length;
  const oldestReview = items[0];
  const oldestMinutes = oldestReview
    ? Math.max(0, Math.floor((Date.now() - new Date(oldestReview.createdAt).getTime()) / 60_000))
    : null;

  return (
    <main className="coach-dashboard">
      <section className="coach-welcome">
        <p className="coach-welcome-eyebrow">Coach workspace <span aria-hidden="true">/</span> Dashboard</p>
        <h1>Welcome back</h1>
        <p>Here’s an overview of the candidate reviews that need your attention.</p>
      </section>

      <section className="coach-next-step" aria-label="Next step">
        <div>
          <span className="coach-next-step-label">Next step · Review next candidate</span>
          <p>{loading ? "Checking for pending reviews…" : items.length ? "Your oldest pending review is ready." : "No reviews are waiting."}</p>
        </div>
        <button
          className="primary"
          type="button"
          disabled={loading || items.length === 0}
          onClick={() => {
            if (items[0]) setSelectedId(items[0].id);
            document.getElementById("coach-review-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          Review next <span aria-hidden="true">→</span>
        </button>
      </section>

      <section className="coach-stats" aria-label="Review summary">
        <article className="coach-stat-card">
          <span>Pending reviews</span>
          <strong>{loading ? "—" : items.length}</strong>
          <span className="coach-stat-icon" aria-hidden="true">◷</span>
        </article>
        <article className="coach-stat-card">
          <span>Interview reviews</span>
          <strong>{loading ? "—" : interviewReviews}</strong>
          <span className="coach-stat-icon coach-stat-icon--purple" aria-hidden="true">◎</span>
        </article>
        <article className="coach-stat-card">
          <span>CV reviews</span>
          <strong>{loading ? "—" : resumeReviews}</strong>
          <span className="coach-stat-icon coach-stat-icon--green" aria-hidden="true">✓</span>
        </article>
        <article className="coach-stat-card">
          <span>Oldest waiting</span>
          <strong>{loading ? "—" : oldestMinutes === null ? "—" : `${oldestMinutes} min`}</strong>
          <span className="coach-stat-icon coach-stat-icon--amber" aria-hidden="true">!</span>
        </article>
      </section>

      {notice && <p className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.message}</p>}

      <div className="coach-review-workspace" id="coach-review-queue">
        <section className="portal-panel coach-queue-panel" aria-label="Pending reviews">
          <div className="coach-queue-heading">
            <div>
              <p className="eyebrow">Your workload</p>
              <h2>Review queue</h2>
            </div>
            <button className="secondary coach-refresh" type="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {loading ? <p className="supporting-copy">Loading reviews…</p> : items.length === 0 ? (
            <p className="supporting-copy">There are no pending reviews.</p>
          ) : (
            <ul className="review-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    className={`review-select${selectedId === item.id ? " selected" : ""}`}
                    type="button"
                    aria-current={selectedId === item.id ? "true" : undefined}
                    onClick={() => {
                      setSelectedId(item.id);
                      setReason("");
                      setCoachFeedback("");
                      setNotice(null);
                    }}
                  >
                    <strong>{reviewTypeLabel(item.targetType)}</strong>
                    <span>{item.riskLevel} risk · {item.flags.join(", ") || "manual review"}</span>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="portal-panel coach-details-panel" aria-label="Review details" aria-live="polite">
          {!selectedId ? (
            <p className="supporting-copy">Select a pending review to see its details.</p>
          ) : detailLoading ? (
            <p className="supporting-copy">Loading review details…</p>
          ) : details ? (
            <>
              <h2>{reviewTypeLabel(details.target.type)}</h2>

              {/* Video player — shown when the candidate submitted a practice video */}
              {details.review.videoUrl && (
                <div className="review-video-section">
                  <h3>Practice video</h3>
                  {videoLoading && <p className="supporting-copy">Loading candidate video…</p>}
                  {videoSource && (
                    <video
                      className="review-video-player"
                      src={videoSource}
                      controls
                      playsInline
                      aria-label="Candidate practice video"
                    />
                  )}
                </div>
              )}

              <ReviewTarget target={details.target} />
              {details.review.requestReason && <p><strong>Candidate note:</strong> {details.review.requestReason}</p>}

              {details.target.type === "interview_evaluation" && (
                <>
                  <label htmlFor="coach-feedback">
                    Coaching feedback <span className="label-required">(sent to candidate)</span>
                  </label>
                  <textarea
                    id="coach-feedback"
                    rows={6}
                    maxLength={5000}
                    placeholder="Write specific feedback for the candidate based on their answers and video. This is what they will read."
                    value={coachFeedback}
                    onChange={(event) => setCoachFeedback(event.target.value)}
                    required
                  />
                </>
              )}

              <label htmlFor="review-reason">
                Internal decision reason <span className="label-hint">(not shown to candidate)</span>
              </label>
              <textarea
                id="review-reason"
                rows={3}
                maxLength={2000}
                placeholder="Explain your decision for the audit log."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
              {(details.target.type === "resume_suggestion" || details.target.type === "resume_draft") && (
                <>
                  <label htmlFor="edited-recommendation">
                    {details.target.type === "resume_draft" ? "Recommendations for the candidate" : "Edited recommendation"}
                  </label>
                  <textarea
                    id="edited-recommendation"
                    rows={details.target.type === "resume_draft" ? 7 : 5}
                    maxLength={5000}
                    value={editedText}
                    onChange={(event) => setEditedText(event.target.value)}
                  />
                </>
              )}
              <div className="actions">
                {details.target.type === "resume_draft" ? (
                  <button className="primary" type="button" disabled={submitting} onClick={() => void submitDecision("edit")}>
                    Send recommendations
                  </button>
                ) : (
                  <button className="primary" type="button" disabled={submitting} onClick={() => void submitDecision("approve")}>
                    {details.target.type === "interview_evaluation" ? "Send feedback to candidate" : "Approve"}
                  </button>
                )}
                {details.target.type === "resume_suggestion" && (
                  <button className="secondary" type="button" disabled={submitting} onClick={() => void submitDecision("edit")}>
                    Save edit
                  </button>
                )}
                <button className="secondary" type="button" disabled={submitting} onClick={() => void submitDecision("reject")}>
                  {details.target.type === "resume_draft" ? "Decline review" : "Reject"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function ReviewTarget({ target }: { target: CoachReviewDetails["target"] }) {
  if (target.type === "job_match") {
    return (
      <div className="review-content">
        <p><strong>Indicative match score:</strong> {target.score}%</p>
        <p>{target.disclaimer}</p>
        <h3>Skill evidence</h3>
        <ul>
          {target.skillResults.map((skill, index) => (
            <li key={`${skill.name}-${index}`}>
              <strong>{skill.name}:</strong> {skill.status}
              {skill.evidenceSnippet && <blockquote>{skill.evidenceSnippet}</blockquote>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (target.type === "resume_suggestion") {
    return (
      <div className="review-content">
        <h3>Candidate’s current CV · {target.candidateResume.fileName}</h3>
        <ResumePreview content={target.candidateResume.content} />
        <p><strong>Reason:</strong> {target.reason}</p>
        <p><strong>Source evidence:</strong></p>
        <blockquote>{target.sourceSnippet}</blockquote>
        <p><strong>Original:</strong></p>
        <blockquote>{target.originalText}</blockquote>
        <p><strong>Current recommendation:</strong></p>
        <blockquote>{target.proposedText}</blockquote>
      </div>
    );
  }
  if (target.type === "resume_draft") {
    return (
      <div className="review-content">
        <h3>Candidate’s current CV · {target.candidateResume.fileName}</h3>
        <ResumePreview content={target.candidateResume.content} />
        <h3>Candidate’s submitted CV draft</h3>
        <ResumePreview content={target.content} />
      </div>
    );
  }
  return (
    <div className="review-content">
      <p><strong>Overall score:</strong> {formatScore(target.overallScore)}%</p>
      <h3>Evaluation</h3>
      <ul>
        {target.dimensions.map((dimension) => (
          <li key={dimension.dimension}><strong>{dimension.dimension} ({formatScore(dimension.score)}/4):</strong> {dimension.feedback}</li>
        ))}
      </ul>
      <h3>Interview answers</h3>
      {target.answers.map((answer, index) => (
        <div key={`${answer.question}-${index}`}>
          <p><strong>{answer.question}</strong></p>
          <blockquote>{answer.answer}</blockquote>
        </div>
      ))}
      <h3>Strengths</h3>
      <ul>{target.strengths.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      <h3>Areas to improve</h3>
      <ul>{target.improvements.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      {target.exampleAnswer && <p><strong>Example answer:</strong> {target.exampleAnswer}</p>}
    </div>
  );
}

function reviewTypeLabel(type: ReviewItem["targetType"]) {
  if (type === "job_match") return "Job match";
  if (type === "resume_suggestion") return "Resume suggestion";
  if (type === "resume_draft") return "Candidate CV draft";
  return "Interview evaluation";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}
