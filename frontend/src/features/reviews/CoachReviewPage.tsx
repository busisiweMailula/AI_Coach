import { useEffect, useState } from "react";
import {
  ApiError,
  decideReview,
  getCoachReviewDetails,
  getPendingReviews,
  type CoachReviewDetails,
  type ReviewItem,
} from "../../api/client";

interface CoachReviewPageProps {
  token: string;
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
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
  }, [token]);

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

  async function submitDecision(decision: "approve" | "edit" | "reject") {
    if (!selectedId || !reason.trim()) {
      setNotice({ message: "Add a reason before submitting a review decision.", error: true });
      return;
    }
    if (decision === "edit" && !editedText.trim()) {
      setNotice({ message: "Provide the edited recommendation before approving it.", error: true });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      await decideReview(token, selectedId, decision, reason, decision === "edit" ? editedText : undefined);
      setItems((current) => current.filter((item) => item.id !== selectedId));
      setSelectedId("");
      setDetails(null);
      setReason("");
      setNotice({ message: "Review decision saved.", error: false });
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card portal-card">
      <p className="eyebrow">Coach workspace</p>
      <h1>Review queue</h1>
      <p className="intro">Review flagged preparation feedback and record a reasoned decision.</p>
      {notice && <p className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.message}</p>}

      <div className="portal-grid">
        <section className="portal-panel" aria-label="Pending reviews">
          <h2>Pending reviews</h2>
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

        <section className="portal-panel" aria-label="Review details" aria-live="polite">
          {!selectedId ? (
            <p className="supporting-copy">Select a pending review to see its details.</p>
          ) : detailLoading ? (
            <p className="supporting-copy">Loading review details…</p>
          ) : details ? (
            <>
              <h2>{reviewTypeLabel(details.target.type)}</h2>
              <ReviewTarget target={details.target} />
              {details.review.requestReason && <p><strong>Candidate request:</strong> {details.review.requestReason}</p>}
              <label htmlFor="review-reason">Decision reason</label>
              <textarea
                id="review-reason"
                rows={3}
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
              {details.target.type === "resume_suggestion" && (
                <>
                  <label htmlFor="edited-recommendation">Edited recommendation</label>
                  <textarea
                    id="edited-recommendation"
                    rows={5}
                    maxLength={5000}
                    value={editedText}
                    onChange={(event) => setEditedText(event.target.value)}
                  />
                </>
              )}
              <div className="actions">
                <button className="primary" type="button" disabled={submitting} onClick={() => void submitDecision("approve")}>
                  Approve
                </button>
                {details.target.type === "resume_suggestion" && (
                  <button className="secondary" type="button" disabled={submitting} onClick={() => void submitDecision("edit")}>
                    Save edit
                  </button>
                )}
                <button className="secondary" type="button" disabled={submitting} onClick={() => void submitDecision("reject")}>
                  Reject
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </section>
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
  return (
    <div className="review-content">
      <p><strong>Overall score:</strong> {target.overallScore}%</p>
      <h3>Evaluation</h3>
      <ul>
        {target.dimensions.map((dimension) => (
          <li key={dimension.dimension}><strong>{dimension.dimension} ({dimension.score}/4):</strong> {dimension.feedback}</li>
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
  return "Interview evaluation";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}
