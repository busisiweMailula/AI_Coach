import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  ApiError,
  claimReview,
  decideReview,
  getCoachReviewDetails,
  getCoachDashboard,
  getPendingReviews,
  getCoachReviewVideo,
  getReviewResumeFile,
  releaseReview,
  type CoachReviewDetails,
  type ReviewItem,
} from "../../api/client";

interface CoachReviewPageProps {
  token: string;
}

export default function CoachReviewPage({ token }: CoachReviewPageProps) {
  const location = useLocation();
  const routeReviewId = /^\/reviews\/([^/]+)$/.exec(location.pathname)?.[1];
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<CoachReviewDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [modifiedOutput, setModifiedOutput] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [coachFeedback, setCoachFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [sort, setSort] = useState<"oldest" | "highest_risk">("oldest");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"dashboard" | "queue">("dashboard");
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getCoachDashboard>> | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    if (routeReviewId) {
      setSelectedId(routeReviewId);
      setView("queue");
    }
  }, [routeReviewId]);

  useEffect(() => {
    let active = true;
    void getCoachDashboard(token).then((result) => { if (active) setDashboard(result); })
      .catch((error: unknown) => { if (active) setNotice({ message: errorMessage(error), error: true }); });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getPendingReviews(token, { search, type: filterType, risk: filterRisk, sort, page, pageSize: 20 })
      .then((result) => {
        if (active) {
          setItems(result.items);
          setTotal(result.total);
        }
      }).catch((error: unknown) => {
        if (active) setNotice({ message: errorMessage(error), error: true });
      }).finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token, search, filterType, filterRisk, sort, page]);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetails(null);
    setNotice(null);
    void claimReview(token, selectedId).then(() => getCoachReviewDetails(token, selectedId)).then((result) => {
      if (active) {
        setDetails(result);
        setModifiedOutput(defaultModifiedOutput(result.target));
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

  async function submitDecision(decision: "approve" | "modify" | "reject") {
    if (!selectedId || !reason.trim()) {
      setNotice({ message: "Add a reason before submitting a review decision.", error: true });
      return;
    }
    if (decision === "modify" && !modifiedOutput.trim()) {
      setNotice({ message: "Provide corrected recommendation text before submitting a modification.", error: true });
      return;
    }
    if (details?.target.type === "interview_evaluation" && !coachFeedback.trim()) {
      setNotice({ message: "Write coaching feedback for the candidate before submitting.", error: true });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      await decideReview(token, selectedId, decision, reason, {
        ...(decision === "modify" ? { modifiedOutput: modifiedOutput.trim() } : {}),
        recommendations: recommendations.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 8),
        ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
        ...(coachFeedback.trim() ? { coachFeedback: coachFeedback.trim() } : {}),
      });
      setItems((current) => current.filter((item) => item.id !== selectedId));
      setSelectedId("");
      setDetails(null);
      setReason("");
      setRecommendations("");
      setInternalNote("");
      setCoachFeedback("");
      setView("queue");
      setNotice({ message: "Review decision saved.", error: false });
      void getCoachDashboard(token).then(setDashboard);
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card portal-card">
      <p className="eyebrow">Coach workspace</p>
      <h1>{view === "dashboard" ? "Coach dashboard" : "Review queue"}</h1>
      <p className="intro">Review candidate preparation results that need a careful human check.</p>
      {notice && <p className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.message}</p>}

      <div className="actions" role="tablist" aria-label="Coach workspace pages">
        <button className={view === "dashboard" ? "primary" : "secondary"} type="button" role="tab" aria-selected={view === "dashboard"} onClick={() => setView("dashboard")}>Dashboard</button>
        <button className={view === "queue" ? "primary" : "secondary"} type="button" role="tab" aria-selected={view === "queue"} onClick={() => setView("queue")}>Review queue</button>
      </div>

      {view === "dashboard" ? (
        <section className="portal-panel" aria-label="Coach dashboard" aria-live="polite">
          {!dashboard ? <p className="supporting-copy">Loading dashboard…</p> : (
            <>
              <div className="coach-metric-grid">
                <Metric label="Pending" value={dashboard.pending} />
                <Metric label="In review by me" value={dashboard.inReviewByMe} />
                <Metric label="Completed today" value={dashboard.completedToday} />
                <Metric label="Completed this week" value={dashboard.completedThisWeek} />
                <Metric label="Average turnaround" value={dashboard.avgTurnaroundMinutes === null ? "—" : `${dashboard.avgTurnaroundMinutes} min`} />
                <Metric label="Oldest waiting" value={dashboard.oldestWaitingAt ? new Date(dashboard.oldestWaitingAt).toLocaleString() : "—"} />
              </div>
              <p className="supporting-copy">Queue by type: {formatCounts(dashboard.byType)} · by risk: {formatCounts(dashboard.byRisk)}</p>
              <div className="actions">
                <button className="primary" type="button" onClick={() => {
                  setView("queue");
                  if (dashboard.nextInQueueId) setSelectedId(dashboard.nextInQueueId);
                }}>Next in queue</button>
                {dashboard.oldestWaitingId && <button className="secondary" type="button" onClick={() => {
                  setView("queue");
                  setSelectedId(dashboard.oldestWaitingId ?? "");
                }}>Open oldest waiting</button>}
              </div>
              <h2>My recent decisions</h2>
              {dashboard.recentDecisions.length === 0 ? <p className="supporting-copy">No decisions yet.</p> : (
                <ul className="review-list">
                  {dashboard.recentDecisions.slice(0, 5).map((item) => (
                    <li key={item.id}><span>{reviewTypeLabel(item.targetType)} · {decisionLabel(item.status)} · {item.decidedAt ? new Date(item.decidedAt).toLocaleString() : ""}</span></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ) : (
        <>
          <section className="portal-panel" aria-label="Review queue filters">
            <div className="review-filters">
              <label>Search<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Candidate, role, CV, or flag" /></label>
              <label>Type<select value={filterType} onChange={(event) => { setFilterType(event.target.value); setPage(1); }}>
                <option value="">All types</option><option value="job_match">Job match</option><option value="resume_suggestion">CV suggestions</option><option value="interview_evaluation">Interview evaluation</option>
              </select></label>
              <label>Risk<select value={filterRisk} onChange={(event) => { setFilterRisk(event.target.value); setPage(1); }}>
                <option value="">All risks</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select></label>
              <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as "oldest" | "highest_risk")}>
                <option value="oldest">Oldest waiting</option><option value="highest_risk">Highest risk</option>
              </select></label>
            </div>
          </section>
          <div className="portal-grid">
            <section className="portal-panel" aria-label="Pending reviews">
              <h2>Review queue ({total})</h2>
              {loading ? <p className="supporting-copy">Loading reviews…</p> : items.length === 0 ? (
                <p className="supporting-copy">No reviews match these filters.</p>
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
                        <strong>{item.candidate?.displayName ?? "Candidate"} · {item.jobTitle ?? reviewTypeLabel(item.targetType)}</strong>
                        <span>{item.resumeName ?? "No CV"} · {reviewTypeLabel(item.targetType)} · {item.riskLevel} risk</span>
                        <span>{item.flagReasons?.join("; ") || "Manual review"}</span>
                        <small>Waiting {formatWaiting(item.waitingSeconds ?? 0)} · {item.status === "in_review" ? "In review" : "Unclaimed"}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="actions">
                <button className="secondary" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
                <span>Page {page}</span>
                <button className="secondary" type="button" disabled={items.length < 20 || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
              </div>
            </section>

            <section className="portal-panel" aria-label="Review details" aria-live="polite">
              {!selectedId ? (
                <p className="supporting-copy">Select a review to claim it and view the scoped context.</p>
              ) : detailLoading ? (
                <p className="supporting-copy">Claiming and loading review details…</p>
              ) : details ? (
                <ReviewContextView
                  details={details}
                  token={token}
                  submitting={submitting}
                  reason={reason}
                  setReason={setReason}
                  modifiedOutput={modifiedOutput}
                  setModifiedOutput={setModifiedOutput}
                  recommendations={recommendations}
                  setRecommendations={setRecommendations}
                  internalNote={internalNote}
                  setInternalNote={setInternalNote}
                  coachFeedback={coachFeedback}
                  setCoachFeedback={setCoachFeedback}
                  submitDecision={submitDecision}
                  onRelease={async () => {
                    try {
                      await releaseReview(token, details.review.id);
                      setSelectedId("");
                      setDetails(null);
                      setNotice({ message: "Review released to the queue.", error: false });
                      const result = await getPendingReviews(token, { search, type: filterType, risk: filterRisk, sort, page, pageSize: 20 });
                      setItems(result.items);
                    } catch (error) {
                      setNotice({ message: errorMessage(error), error: true });
                    }
                  }}
                />
              ) : null}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function ReviewContextView({
  details, token, submitting, reason, setReason, modifiedOutput, setModifiedOutput,
  recommendations, setRecommendations, internalNote, setInternalNote, coachFeedback, setCoachFeedback, submitDecision, onRelease,
}: {
  details: CoachReviewDetails;
  token: string;
  submitting: boolean;
  reason: string;
  setReason: (value: string) => void;
  modifiedOutput: string;
  setModifiedOutput: (value: string) => void;
  recommendations: string;
  setRecommendations: (value: string) => void;
  internalNote: string;
  setInternalNote: (value: string) => void;
  coachFeedback: string;
  setCoachFeedback: (value: string) => void;
  submitDecision: (decision: "approve" | "modify" | "reject") => Promise<void>;
  onRelease: () => Promise<void>;
}) {
  const [fileError, setFileError] = useState("");
  const [videoSource, setVideoSource] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  useEffect(() => {
    const videoUrl = details.review.videoUrl;
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
      if (active) setFileError(errorMessage(error));
    }).finally(() => {
      if (active) setVideoLoading(false);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [details.review.videoUrl, token]);

  const citations = details.target.type === "job_match"
    ? details.target.skillResults.flatMap((item) => item.evidenceSnippet ? [item.evidenceSnippet] : [])
    : details.target.type === "resume_suggestion" ? [details.target.sourceSnippet] : [];

  async function downloadOriginal() {
    try {
      const blob = await getReviewResumeFile(token, details.review.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = details.resume?.fileName ?? "resume";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFileError("");
    } catch (error) {
      setFileError(errorMessage(error));
    }
  }

  return (
    <div className="review-context">
      <header>
        <h2>{reviewTypeLabel(details.target.type)}</h2>
        <span className={`risk-badge risk-${details.review.riskLevel}`}>{details.review.riskLevel} risk</span>
      </header>
      {details.review.videoUrl && (
        <section className="review-video-section">
          <h3>Practice video</h3>
          {videoLoading && <p className="supporting-copy">Loading candidate video…</p>}
          {videoSource && <video className="review-video-player" src={videoSource} controls playsInline aria-label="Candidate practice video" />}
        </section>
      )}
      <section>
        <h3>Candidate account</h3>
        <p><strong>{details.candidate.displayName}</strong> · {details.candidate.email}</p>
        <p className="supporting-copy">Account ID: {details.candidate.id} · Registered {new Date(details.candidate.registeredAt).toLocaleString()}</p>
      </section>
      {details.job && (
        <details className="review-disclosure">
          <summary>{details.job.title}{details.job.company ? ` · ${details.job.company}` : ""} — full job description</summary>
          <p className="supporting-copy">Added {new Date(details.job.createdAt).toLocaleDateString()}</p>
          <pre>{details.job.text}</pre>
        </details>
      )}
      {details.resume && (
        <section>
          <h3>CV</h3>
          <p><strong>{details.resume.title || details.resume.fileName}</strong></p>
          <p className="supporting-copy">Original file: {details.resume.fileName} · Uploaded {new Date(details.resume.createdAt).toLocaleString()}</p>
          <button className="secondary" type="button" onClick={() => void downloadOriginal()}>Download original CV</button>
          {fileError && <p className="notice error" role="alert">{fileError}</p>}
          <div className="review-cv">
            {details.resume.structuredCv ? (
              details.resume.structuredCv.sections.map((section) => (
                <section key={section.id}>
                  <h4>{section.heading}</h4>
                  {section.groups.map((group) => <p key={group.id}>{group.label && <strong>{group.label}: </strong>}<EvidenceText text={group.value} citations={citations} /></p>)}
                  {section.entries.map((entry) => (
                    <div key={entry.id}>
                      <p><strong>{[entry.title, entry.company, entry.location, entry.dates].filter(Boolean).join(" · ")}</strong></p>
                      {entry.lines.map((line) => <p key={line.id}><EvidenceText text={line.text} citations={citations} /></p>)}
                    </div>
                  ))}
                  {section.paragraphs.map((line) => <p key={line.id}><EvidenceText text={line.text} citations={citations} /></p>)}
                </section>
              ))
            ) : <pre>{details.resume.extractedText}</pre>}
          </div>
          {citations.length > 0 && (
            <div className="review-citations">
              <h4>AI evidence citations</h4>
              <ul>{citations.map((citation, index) => {
                const found = details.resume?.extractedText.toLocaleLowerCase("en").includes(citation.toLocaleLowerCase("en")) ?? false;
                return <li key={`${citation}-${index}`}><span className={found ? "citation-found" : "citation-missing"}>{found ? "Found in CV" : "Not found in CV"}</span><blockquote>{citation}</blockquote></li>;
              })}</ul>
            </div>
          )}
        </section>
      )}
      <section>
        <h3>Why it was flagged</h3>
        <ul className="review-flag-list">
          {(details.review.flagReasons ?? details.review.flags.map(describeFlag)).map((flag) => <li key={flag}>{flag}</li>)}
        </ul>
        {details.review.requestReason && <p><strong>Candidate request:</strong> {details.review.requestReason}</p>}
      </section>
      <section>
        <h3>AI output under review</h3>
        <ReviewTarget target={details.target} />
      </section>
      {details.history.length > 0 && (
        <details className="review-disclosure">
          <summary>Review history ({details.history.length})</summary>
          <ol>{details.history.map((entry, index) => (
            <li key={`${entry.action}-${index}`}><strong>{historyLabel(entry.action)}</strong> by {entry.actor} · {new Date(entry.createdAt).toLocaleString()}{entry.details ? <p>{entry.details}</p> : null}</li>
          ))}</ol>
        </details>
      )}
      <section className="review-decision-form">
        <h3>Coach decision</h3>
        {details.target.type === "interview_evaluation" && (
          <>
            <label htmlFor="coach-feedback">Coaching feedback (sent to candidate, required)</label>
            <textarea id="coach-feedback" rows={6} maxLength={5000} value={coachFeedback} onChange={(event) => setCoachFeedback(event.target.value)} required />
          </>
        )}
        <label htmlFor="review-reason">Written reason (required)</label>
        <textarea id="review-reason" rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} required />
        <label htmlFor="review-modified-output">Corrected recommendation / reviewed output (required for Modify)</label>
        <textarea id="review-modified-output" rows={5} maxLength={5000} value={modifiedOutput} onChange={(event) => setModifiedOutput(event.target.value)} />
        <label htmlFor="coach-recommendations">Optional recommendations (one actionable item per line, up to 8)</label>
        <textarea id="coach-recommendations" rows={4} maxLength={2400} value={recommendations} onChange={(event) => setRecommendations(event.target.value)} />
        <label htmlFor="coach-internal-note">Internal note (not shown to candidate)</label>
        <textarea id="coach-internal-note" rows={2} maxLength={2000} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} />
        <div className="actions">
          <button className="primary" type="button" disabled={submitting || !reason.trim()} onClick={() => void submitDecision("approve")}>Approve</button>
          <button className="primary" type="button" disabled={submitting || !reason.trim() || !modifiedOutput.trim()} onClick={() => void submitDecision("modify")}>Modify</button>
          <button className="secondary" type="button" disabled={submitting || !reason.trim()} onClick={() => void submitDecision("reject")}>Reject</button>
          <button className="secondary" type="button" disabled={submitting} onClick={() => void onRelease()}>Release claim</button>
        </div>
      </section>
    </div>
  );
}

function EvidenceText({ text, citations }: { text: string; citations: string[] }) {
  const lower = text.toLocaleLowerCase("en");
  const matching = citations.map((citation) => ({ citation, start: lower.indexOf(citation.toLocaleLowerCase("en")) }))
    .filter((match) => match.start >= 0)
    .sort((left, right) => left.start - right.start)[0];
  if (!matching) return <>{text}</>;
  const end = matching.start + matching.citation.length;
  return <>{text.slice(0, matching.start)}<mark>{text.slice(matching.start, end)}</mark>{text.slice(end)}</>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="coach-metric"><span>{label}</span><strong>{value}</strong></article>;
}

function ReviewTarget({ target }: { target: CoachReviewDetails["target"] }) {
  if (target.type === "job_match") {
    return (
      <div className="review-content">
        <p><strong>Indicative match score:</strong> {target.score}%</p>
        <p>{target.disclaimer}</p>
        <h3>Matched requirements</h3>
        <ul>{target.skillResults.filter((skill) => skill.status === "matched").map((skill, index) => (
          <li key={`${skill.name}-${index}`}><strong>{skill.name}</strong>{skill.evidenceSnippet && <blockquote>{skill.evidenceSnippet}</blockquote>}</li>
        ))}</ul>
        <h3>Missing or uncertain requirements</h3>
        <ul>{target.skillResults.filter((skill) => skill.status !== "matched").map((skill, index) => (
          <li key={`${skill.name}-${index}`}><strong>{skill.name}:</strong> {skill.status}</li>
        ))}</ul>
        {target.reviewedOutput && <p><strong>Reviewed output:</strong> {target.reviewedOutput}</p>}
        <h3>All skill results</h3>
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
        {target.jobRequirement && <p><strong>Job requirement:</strong> {target.jobRequirement}</p>}
        {target.reviewedOutput && <p><strong>Reviewed output:</strong> {target.reviewedOutput}</p>}
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
      {target.reviewedOutput && <p><strong>Reviewed output:</strong> {target.reviewedOutput}</p>}
    </div>
  );
}

function defaultModifiedOutput(target: CoachReviewDetails["target"]): string {
  if (target.type === "resume_suggestion") return target.reviewedOutput ?? target.proposedText;
  return target.reviewedOutput ?? "";
}

function describeFlag(flag: string): string {
  const reasons: Record<string, string> = {
    evidence_not_found_in_source: "The AI cited evidence that could not be found in the CV text.",
    low_confidence: "The AI reported low confidence in this result.",
    fabrication_guardrail_hit: "The output may contain a claim not supported by the source.",
    possible_protected_trait_reference: "The output may refer to a protected personal trait.",
    candidate_requested_review: "The candidate asked for a coach to review this item.",
    random_quality_sample: "This item was selected for a quality review.",
  };
  return reasons[flag] ?? flag.replaceAll("_", " ");
}

function historyLabel(action: string): string {
  return action.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("en"));
}

function decisionLabel(status: ReviewItem["status"]): string {
  return status === "approved" ? "Approved" : status === "edited" ? "Modified" : status === "rejected" ? "Rejected" : "In review";
}

function formatWaiting(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const days = Math.floor(seconds / 86400);
  return days > 0 ? `${days}d ${Math.floor(seconds % 86400 / 3600)}h` : `${Math.floor(seconds / 3600)}h`;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(", ") || "none";
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
