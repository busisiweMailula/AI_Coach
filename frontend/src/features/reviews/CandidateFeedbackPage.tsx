import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  getCandidateFeedback,
  getCandidateFeedbackDetails,
  type CandidateCoachFeedback,
  type ReviewItem,
} from "../../api/client";

export default function CandidateFeedbackPage({ token, reviewId }: { token: string; reviewId?: string }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [details, setDetails] = useState<CandidateCoachFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getCandidateFeedback(token).then((result) => {
      if (active) setItems(result.items);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!reviewId) {
      setDetails(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetails(null);
    void getCandidateFeedbackDetails(token, reviewId).then((result) => {
      if (active) setDetails(result);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [token, reviewId]);

  return (
    <div className="feedback-layout">
      <section className="workspace-panel" aria-label="Coach feedback history">
        <h2>Coach feedback</h2>
        {loading ? <p className="supporting-copy">Loading feedback…</p>
          : items.length === 0 ? <p className="supporting-copy">No completed coach reviews yet.</p>
            : <ul className="review-list">{items.map((item) => (
              <li key={item.id}>
                <Link className={`feedback-list-item${reviewId === item.id ? " selected" : ""}`} to={`/coach-feedback/${item.id}`}>
                  <strong>{reviewLabel(item.targetType)}</strong>
                  <span>{decisionLabel(item.status)} · {new Date(item.decidedAt ?? item.updatedAt).toLocaleString()}</span>
                  <small>{item.decisionReason}</small>
                </Link>
              </li>
            ))}</ul>}
      </section>
      <section className="workspace-panel" aria-live="polite">
        {error && <p className="notice error" role="alert">{error}</p>}
        {!reviewId ? <p className="supporting-copy">Select a completed review to read your coach’s feedback.</p>
          : detailLoading ? <p className="supporting-copy">Loading coach feedback…</p>
            : details ? (
              <>
                <p className="eyebrow">Reviewed by {details.coachName}</p>
                <h2>{reviewLabel(details.review.targetType)} · {details.decisionLabel}</h2>
                <p><strong>Reason:</strong> {details.reason}</p>
                {details.recommendations.length > 0 && (
                  <>
                    <h3>Coach recommendations</h3>
                    <ul>{details.recommendations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
                  </>
                )}
                {details.modifiedOutput && (
                  <>
                    <h3>Reviewed output</h3>
                    <p className="feedback-output">{details.modifiedOutput}</p>
                  </>
                )}
                {details.originalOutput && (
                  <details className="review-disclosure">
                    <summary>Compare with original AI output</summary>
                    <pre>{details.originalOutput}</pre>
                  </details>
                )}
              </>
            ) : null}
      </section>
    </div>
  );
}

function reviewLabel(type: ReviewItem["targetType"]) {
  return type === "job_match" ? "Job match"
    : type === "resume_suggestion" ? "CV suggestions"
      : "Interview evaluation";
}

function decisionLabel(status: ReviewItem["status"]) {
  return status === "approved" ? "Approved" : status === "edited" ? "Modified" : "Rejected";
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message
    : error instanceof Error ? error.message
      : "Coach feedback could not be loaded.";
}
