import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import {
  ApiError,
  analyzeMatch,
  analyzeSkillGaps,
  answerInterview,
  decideSuggestion,
  downloadResumeCv,
  evaluateInterview,
  generateQuestions,
  getCandidateProgress,
  getConsentStatus,
  getInterview,
  getInterviewResults,
  getJob,
  getJobs,
  getJobStatus,
  getMatch,
  getQuestionSet,
  getResume,
  getResumePreview,
  getResumes,
  getSkillGaps,
  optimizeResume,
  recordConsent,
  startInterview,
  submitJobDescription,
  updateResume,
  uploadResume,
  type CandidateProgress,
  type ConsentStatus,
  type InterviewEvaluation,
  type InterviewQuestion,
  type InterviewSession,
  type InterviewType,
  type JobDescription,
  type MatchResult,
  type Resume,
  type ResumeSuggestion,
  type StructuredCv,
  type SkillGapResult,
} from "../../api/client";
import { useInterviewSpeech } from "./interview-speech";
import { useInterviewRecognition } from "./interview-recognition";
import CandidateFeedbackPage from "../reviews/CandidateFeedbackPage";
import NotificationBell from "../notifications/NotificationBell";
import NotificationCenter from "../notifications/NotificationCenter";

interface Props {
  token: string;
  email: string;
  onWithdraw: () => Promise<void>;
  onConsentRejected: () => Promise<void>;
  onSignOut: () => void;
}

type Tab = "dashboard" | "resume" | "jobs" | "match" | "studio" | "interview" | "feedback" | "notifications" | "privacy";

const workspaceNavigation: Array<{ label: string; tabs: Tab[] }> = [
  { label: "Overview", tabs: ["dashboard"] },
  { label: "Resume & role", tabs: ["resume", "jobs"] },
  { label: "Match & coaching", tabs: ["match", "studio"] },
  { label: "Interview practice", tabs: ["interview"] },
  { label: "Coach feedback", tabs: ["feedback"] },
  { label: "Notifications", tabs: ["notifications"] },
  { label: "Privacy & settings", tabs: ["privacy"] },
];

export default function CandidateWorkspace({ token, email, onWithdraw, onConsentRejected, onSignOut }: Props) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const location = useLocation();
  const feedbackId = /^\/coach-feedback\/([^/]+)$/.exec(location.pathname)?.[1];
  const [progress, setProgress] = useState<CandidateProgress | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [jobs, setJobs] = useState<JobDescription[]>([]);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getCandidateProgress(token), getResumes(token), getJobs(token)])
      .then(([progressResult, resumeResult, jobResult]) => {
        if (!active) return;
        setProgress(progressResult);
        setResumes(resumeResult.items);
        setSelectedResumeId((current) => resumeResult.items.some((resume) => resume.id === current)
          ? current
          : resumeResult.items[0]?.id ?? "");
        setJobs(jobResult.items);
      })
      .catch((error: unknown) => {
        if (active) setNotice({ text: errorMessage(error), error: true });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  async function refreshData() {
    const [progressResult, resumeResult, jobResult] = await Promise.all([
      getCandidateProgress(token), getResumes(token), getJobs(token),
    ]);
    setProgress(progressResult);
    setResumes(resumeResult.items);
    setJobs(jobResult.items);
  }

  function navigateTo(next: Tab) {
    setTab(next);
    setNotice(null);
  }

  const activeSection = workspaceNavigation.find((item) => item.tabs.includes(tab))?.label ?? "Overview";

  useEffect(() => {
    if (location.pathname === "/coach-feedback" || feedbackId) setTab("feedback");
    else if (location.pathname === "/notifications") setTab("notifications");
  }, [location.pathname, feedbackId]);

  return (
    <div className="candidate-layout">
      <aside className="candidate-sidebar">
        <Link className="candidate-brand" to="/" aria-label="Careerkit overview">
          <span className="brand-mark">C</span>
          <span>careerkit</span>
        </Link>
        <p className="sidebar-label">Your workspace</p>
        <nav className="sidebar-navigation" aria-label="Candidate workspace">
          {workspaceNavigation.map((item, index) => {
            const active = item.tabs.includes(tab);
            return (
              <button
                className={`sidebar-link${active ? " active" : ""}`}
                key={item.label}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => navigateTo(active ? tab : item.tabs[0])}
              >
                <span className="sidebar-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{item.label}</span>
                {active && <span className="sidebar-chevron" aria-hidden="true">↗</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-tip">
          <span className="tip-star" aria-hidden="true">✳</span>
          <p>Your next step is built from your own evidence. No evidence found is not the same as lacking a skill.</p>
        </div>
        <div className="sidebar-profile">
          <span className="profile-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
          <span className="profile-copy"><strong>{email}</strong><small>Candidate account</small></span>
          <button className="signout-button" type="button" title="Sign out" aria-label="Sign out" onClick={onSignOut}>↪</button>
        </div>
      </aside>

      <div className="candidate-main-shell">
        <header className="candidate-topbar">
          <p>Workspace <span>/</span> {activeSection}</p>
          <div className="candidate-topbar-actions"><NotificationBell token={token} /><span className="private-session"><i /> Private session</span></div>
        </header>
        <main className="candidate-main">
          <div className="candidate-content">
            {notice && <p className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
            {loading ? <p className="workspace-loading" aria-live="polite">Loading your workspace…</p> : (
              <>
                {tab === "dashboard" && (
                  <Dashboard
                    email={email}
                    progress={progress}
                    resumes={resumes}
                    jobs={jobs}
                    onOpen={navigateTo}
                  />
                )}
                {(tab === "resume" || tab === "jobs") && (
                  <>
                    <WorkspacePageHeading
                      eyebrow="Resume and role"
                      title="Bring your experience and opportunity together."
                      description="Add a CV and role description to shape your preparation around real evidence."
                    />
                    <WorkspaceSubnav
                      label="Resume and role tools"
                      items={[["resume", "Your CV"], ["jobs", "Job description"]]}
                      selected={tab}
                      onSelect={navigateTo}
                    />
                    {tab === "resume" ? (
                      <ResumeSection
                        token={token}
                        resumes={resumes}
                        selectedResumeId={selectedResumeId}
                        onSelectResume={setSelectedResumeId}
                        onChanged={refreshData}
                        onConsentRejected={onConsentRejected}
                      />
                    ) : (
                      <JobsSection token={token} jobs={jobs} onChanged={refreshData} />
                    )}
                  </>
                )}
                {(tab === "match" || tab === "studio") && (
                  <>
                    <WorkspacePageHeading
                      eyebrow="Match and coaching"
                      title="Turn evidence into a focused plan."
                      description="Explore role alignment and review suggestions grounded in your CV."
                    />
                    <WorkspaceSubnav
                      label="Match and coaching tools"
                      items={[["match", "Match analysis"], ["studio", "Resume studio"]]}
                      selected={tab}
                      onSelect={navigateTo}
                    />
                    {tab === "match"
                      ? <MatchSection token={token} resumes={resumes} selectedResumeId={selectedResumeId} jobs={jobs} />
                      : <StudioSection
                        key={`${token}:${selectedResumeId}`}
                        token={token}
                        resumes={resumes}
                        selectedResumeId={selectedResumeId}
                        jobs={jobs}
                      />}
                  </>
                )}
                {tab === "interview" && (
                  <>
                    <WorkspacePageHeading
                      eyebrow="Interview practice"
                      title="Practise with a little more confidence."
                      description="Build questions for a role, practise one answer at a time, and review actionable feedback."
                    />
                    <InterviewSection token={token} resumes={resumes} selectedResumeId={selectedResumeId} jobs={jobs} />
                  </>
                )}
                {tab === "feedback" && (
                  <>
                    <WorkspacePageHeading
                      eyebrow="Coach feedback"
                      title="A human review of your preparation."
                      description="Read your coach’s decision and recommendations for reviewed items."
                    />
                    <CandidateFeedbackPage token={token} reviewId={feedbackId} />
                  </>
                )}
                {tab === "notifications" && (
                  <>
                    <WorkspacePageHeading eyebrow="Notifications" title="Stay up to date." description="Recent updates for your account and coach reviews." />
                    <NotificationCenter token={token} />
                  </>
                )}
                {tab === "privacy" && (
                  <>
                    <WorkspacePageHeading
                      eyebrow="Privacy and settings"
                      title="Your information stays yours."
                      description="Review your processing consent and find out how your CV data is handled."
                    />
                    <PrivacySettings token={token} onWithdraw={onWithdraw} />
                  </>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function WorkspacePageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="workspace-page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="intro">{description}</p>
    </div>
  );
}

function WorkspaceSubnav({ label, items, selected, onSelect }: {
  label: string;
  items: Array<[Tab, string]>;
  selected: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <nav className="workspace-subnav" aria-label={label}>
      {items.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className={selected === id ? "active" : ""}
          aria-current={selected === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          {text}
        </button>
      ))}
    </nav>
  );
}

function Dashboard({ email, progress, resumes, jobs, onOpen }: {
  email: string;
  progress: CandidateProgress | null;
  resumes: Resume[];
  jobs: JobDescription[];
  onOpen: (tab: Tab) => void;
}) {
  const practiceScore = progress?.averageRubricScores.overall;
  return (
    <>
      <div className="overview-heading">
        <div>
          <p className="eyebrow">Your candidate space</p>
          <h1>A good next move starts here.</h1>
          <p className="intro">Welcome back, {email}. Build a focused plan from the experience you already have.</p>
        </div>
        <span className="candidate-badge">Candidate account</span>
      </div>
      <section className="studio-hero">
        <div className="hero-copy">
          <p className="hero-eyebrow">The preparation studio</p>
          <h2>Make your next opportunity feel more familiar.</h2>
          <p>Bring a resume and a role description. We’ll help you see the evidence, find useful practice areas, and prepare clear answers.</p>
          <button className="hero-button" type="button" onClick={() => onOpen("resume")}>
            Set up your workspace <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="evidence-art" aria-hidden="true">
          <div className="evidence-back" />
          <div className="evidence-card">
            <span className="evidence-spark">✳</span>
            <strong>Evidence</strong>
            <i />
            <small>Your experience, clearly told.</small>
          </div>
        </div>
      </section>
      <div className="overview-metrics">
        <article className="overview-metric">
          <span className="metric-icon sessions-icon" aria-hidden="true">↗</span>
          <div><span>Completed sessions</span><strong>{progress?.completedInterviews ? progress.completedInterviews : "—"}</strong><small>Saved to your account</small></div>
        </article>
        <article className="overview-metric">
          <span className="metric-icon answers-icon" aria-hidden="true">◉</span>
          <div><span>Answers evaluated</span><strong>{progress?.completedEvaluations ? progress.completedEvaluations : "—"}</strong><small>Practice feedback, not a hiring score</small></div>
        </article>
        <article className="overview-metric">
          <span className="metric-icon score-icon" aria-hidden="true">✳</span>
          <div><span>Latest practice score</span><strong>{practiceScore == null ? "—" : `${practiceScore.toFixed(2)}%`}</strong><small>Complete an interview to get feedback</small></div>
        </article>
      </div>
      <div className="overview-next-steps">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h2>Choose what to work on next</h2>
        </div>
        <div className="next-step-actions">
          <button type="button" onClick={() => onOpen("jobs")}>Add a role <span aria-hidden="true">→</span></button>
          <button type="button" onClick={() => onOpen("match")}>Explore your match <span aria-hidden="true">→</span></button>
          <button type="button" onClick={() => onOpen("interview")}>Practise an interview <span aria-hidden="true">→</span></button>
        </div>
        <p className="overview-footnote">CV and interview feedback is guidance based on the information you provide, not a hiring decision.</p>
        {(resumes.length > 0 || jobs.length > 0) && (
          <p className="workspace-readiness">{resumes.length} CV{resumes.length === 1 ? "" : "s"} · {jobs.length} role{jobs.length === 1 ? "" : "s"} saved</p>
        )}
      </div>
    </>
  );
}

function PrivacySettings({ token, onWithdraw }: { token: string; onWithdraw: () => Promise<void> }) {
  const [consents, setConsents] = useState<ConsentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingHumanReview, setSavingHumanReview] = useState(false);

  async function setHumanReviewConsent(granted: boolean) {
    setSavingHumanReview(true);
    setError("");
    try {
      await recordConsent(token, "human_review", granted);
      setConsents((current) => current.map((item) => item.purpose === "human_review"
        ? { ...item, accepted: granted }
        : item));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingHumanReview(false);
    }
  }

  useEffect(() => {
    let active = true;
    void getConsentStatus(token).then((result) => {
      if (active) setConsents(result);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [token]);

  return (
    <div className="privacy-settings-grid">
      <section className="workspace-panel">
        <p className="eyebrow">Consent</p>
        <h2>Your current settings</h2>
        {loading ? <p className="supporting-copy">Checking consent…</p> : error ? (
          <p className="notice error" role="alert">{error}</p>
        ) : (
          <ul className="consent-status-list">
            {consents.map((consent) => (
              <li key={consent.purpose}>
                <span><strong>{consentPurposeLabel(consent.purpose)}</strong><small>Policy {consent.policyVersion}</small></span>
                <span className={`consent-pill${consent.accepted ? " accepted" : ""}`}>{consent.accepted ? "Accepted" : "Not accepted"}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="secondary" type="button" disabled={loading || Boolean(error)} onClick={() => void onWithdraw()}>
          Withdraw CV processing consent
        </button>
        <button
          className="secondary"
          type="button"
          disabled={loading || savingHumanReview || Boolean(error)}
          onClick={() => void setHumanReviewConsent(!consents.find((item) => item.purpose === "human_review")?.accepted)}
        >
          {savingHumanReview ? "Saving…" : consents.find((item) => item.purpose === "human_review")?.accepted
            ? "Withdraw human-review consent"
            : "Allow coach review"}
        </button>
      </section>
      <section className="workspace-panel privacy-info-panel">
        <p className="eyebrow">Your data</p>
        <h2>Private by design</h2>
        <p>Your CV and preparation data are associated with your account. You can withdraw CV processing consent at any time; this blocks further CV access in the workspace.</p>
        <Link to="/privacy-policy">Read the privacy policy <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  );
}

function consentPurposeLabel(purpose: string) {
  if (purpose === "human_review") return "Human coach review";
  if (purpose === "resume_processing") return "CV processing";
  if (purpose === "external_model_processing") return "External AI processing";
  return purpose.replaceAll("_", " ");
}

function ResumeSection({ token, resumes, selectedResumeId, onSelectResume, onChanged, onConsentRejected }: {
  token: string;
  resumes: Resume[];
  selectedResumeId: string;
  onSelectResume: (resumeId: string) => void;
  onChanged: () => Promise<void>;
  onConsentRejected: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Resume | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!selectedResumeId) { setSelected(null); return; }
    let active = true;
    void getResume(token, selectedResumeId).then((result) => {
      if (!active) return;
      setSelected(result.resume);
      setTitle(result.resume.title ?? "");
      setNotes(result.resume.notes ?? "");
    }).catch((error: unknown) => {
      if (active) setNotice({ text: errorMessage(error), error: true });
    });
    return () => { active = false; };
  }, [token, selectedResumeId]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await uploadResume(token, file);
      onSelectResume(result.resume.id);
      if (result.resume.parseJobId) await waitForJob(token, result.resume.parseJobId);
      await onChanged();
      setNotice({ text: "CV uploaded successfully.", error: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) await onConsentRejected();
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function saveMetadata() {
    if (!selectedResumeId) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateResume(token, selectedResumeId, { title: title.trim() || undefined, notes: notes.trim() });
      await onChanged();
      setNotice({ text: "CV details saved.", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-grid">
      <section className="workspace-panel">
        <h2>Upload a CV</h2>
        <form className="form-stack" onSubmit={(event) => void upload(event)}>
          <label htmlFor="cv-file">PDF or DOCX CV</label>
          <input ref={fileRef} id="cv-file" type="file" accept=".pdf,.docx" disabled={busy} required />
          <button className="primary" type="submit" disabled={busy}>{busy ? "Processing…" : "Upload CV"}</button>
        </form>
        {resumes.length > 0 && (
          <>
            <h2 className="section-heading">Your CVs</h2>
            <select value={selectedResumeId} onChange={(event) => onSelectResume(event.target.value)} aria-label="Select CV">
              {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title || resume.originalFileName}</option>)}
            </select>
          </>
        )}
      </section>
      <section className="workspace-panel" aria-live="polite">
        {notice && <p className={`notice${notice.error ? " error" : ""}`}>{notice.text}</p>}
        {selected ? (
          <>
            <h2>{selected.originalFileName}</h2>
            <p className="supporting-copy">Parse status: {selected.parseStatus} · extraction: {selected.textExtractionStatus}</p>
            <label htmlFor="resume-title">Title</label>
            <input id="resume-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
            <label htmlFor="resume-notes">Notes</label>
            <textarea id="resume-notes" rows={4} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
            <button className="secondary" type="button" disabled={busy} onClick={() => void saveMetadata()}>Save details</button>
            {selected.extractedText && (
              <>
                <h2 className="section-heading">Extracted text</h2>
                <pre className="source-preview">{selected.extractedText}</pre>
              </>
            )}
          </>
        ) : <p className="supporting-copy">Upload a CV to view and edit its metadata.</p>}
      </section>
    </div>
  );
}

function JobsSection({ token, jobs, onChanged }: {
  token: string;
  jobs: JobDescription[];
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [selectedId, setSelectedId] = useState(jobs[0]?.id ?? "");
  const [selected, setSelected] = useState<JobDescription | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let active = true;
    void getJob(token, selectedId).then((result) => {
      if (active) setSelected(result);
    }).catch((error: unknown) => {
      if (active) setNotice({ text: errorMessage(error), error: true });
    });
    return () => { active = false; };
  }, [token, selectedId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const accepted = await submitJobDescription(token, { text });
      await waitForJob(token, accepted.jobId);
      await onChanged();
      setText("");
      setSelectedId(accepted.jobDescriptionId);
      setNotice({ text: "Job description added and analysed.", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-grid">
      <section className="workspace-panel">
        <h2>Add a job description</h2>
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <label htmlFor="job-text">Paste the role description</label>
          <textarea id="job-text" rows={10} maxLength={50000} value={text} onChange={(event) => setText(event.target.value)} required />
          <button className="primary" type="submit" disabled={busy}>{busy ? "Analysing…" : "Save and analyse"}</button>
        </form>
        {jobs.length > 0 && (
          <>
            <h2 className="section-heading">Existing descriptions</h2>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="Select job description">
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.roleTitle || `Job ${job.id.slice(-6)}`}</option>)}
            </select>
          </>
        )}
      </section>
      <section className="workspace-panel">
        {selected ? (
          <>
            <h2>{selected.roleTitle || "Job description"}</h2>
            <p className="supporting-copy">Analysis status: {selected.analysisStatus}</p>
            {selected.requiredSkills && <><h3>Required skills</h3><SkillList items={selected.requiredSkills.map((item) => item.name)} /></>}
            {selected.preferredSkills && <><h3>Preferred skills</h3><SkillList items={selected.preferredSkills.map((item) => item.name)} /></>}
            {selected.responsibilities && <><h3>Responsibilities</h3><SkillList items={selected.responsibilities.map((item) => item.text)} /></>}
            {selected.text && <><h2 className="section-heading">Source text</h2><pre className="source-preview">{selected.text}</pre></>}
          </>
        ) : <p className="supporting-copy">Add a description to begin job-specific preparation.</p>}
        {notice && <p className={`notice${notice.error ? " error" : ""}`}>{notice.text}</p>}
      </section>
    </div>
  );
}

function MatchSection({ token, resumes, selectedResumeId, jobs }: {
  token: string;
  resumes: Resume[];
  selectedResumeId: string;
  jobs: JobDescription[];
}) {
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [gaps, setGaps] = useState<SkillGapResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const selectedResume = resumes.find((resume) => resume.id === selectedResumeId);

  async function run() {
    if (!selectedResumeId || !jobId) {
      setNotice({ text: "Select a CV in Resume & role and choose a job description.", error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    setMatch(null);
    setGaps(null);
    try {
      const [matchJob, gapJob] = await Promise.all([
        analyzeMatch(token, selectedResumeId, jobId),
        analyzeSkillGaps(token, selectedResumeId, jobId),
      ]);
      const [matchStatus, gapStatus] = await Promise.all([
        waitForJob(token, matchJob.jobId),
        waitForJob(token, gapJob.jobId),
      ]);
      if (matchStatus.resultId) setMatch(await getMatch(token, matchStatus.resultId));
      if (gapStatus.resultId) setGaps(await getSkillGaps(token, gapStatus.resultId));
      setNotice({ text: "Match and skill-gap analysis completed.", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-panel">
      <h2>CV and job match</h2>
      <p className="supporting-copy">
        Using CV: <strong>{selectedResume ? (selectedResume.title || selectedResume.originalFileName) : "Select or upload a CV in Resume & role"}</strong>
      </p>
      <div className="selector-grid">
        <label>Job description<select value={jobId} onChange={(event) => setJobId(event.target.value)}>
          <option value="">Select job</option>
          {jobs.map((job) => <option key={job.id} value={job.id}>{job.roleTitle || `Job ${job.id.slice(-6)}`}</option>)}
        </select></label>
        <button className="primary" type="button" disabled={busy} onClick={() => void run()}>{busy ? "Analysing…" : "Run analysis"}</button>
      </div>
      {notice && <p className={`notice${notice.error ? " error" : ""}`}>{notice.text}</p>}
      {match && (
        <section className="result-section">
          <h2>Indicative match: {match.score}%</h2>
          {isCoachReviewed(match.reviewStatus) && <p className="reviewed-indicator">Reviewed by a coach</p>}
          {match.reviewedOutput && <p className="feedback-output">{match.reviewedOutput}</p>}
          <p>{match.disclaimer}</p>
          <div className="score-grid">{Object.entries(match.scoreBreakdown).map(([name, score]) =>
            <div key={name}><span>{name}</span><strong>{score}%</strong></div>)}</div>
          <h3>Evidence</h3>
          {match.skillResults.map((skill, index) => (
            <article className="result-row" key={`${skill.name}-${index}`}>
              <strong>{skill.name}</strong><span className={`status-${skill.status}`}>{skill.status}</span>
              {skill.evidenceSnippet && <blockquote>{skill.evidenceSnippet}</blockquote>}
            </article>
          ))}
        </section>
      )}
      {gaps && (
        <section className="result-section">
          <h2>Skill gaps</h2>
          {gaps.categories.map((category) => (
            <article key={category.name}>
              <h3>{category.name}</h3>
              {category.items.map((item) => <div className="gap-row" key={item.skill}><strong>{item.skill}</strong><span>{item.evidenceStatus}</span></div>)}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function StudioSection({ token, resumes, selectedResumeId, jobs }: {
  token: string;
  resumes: Resume[];
  selectedResumeId: string;
  jobs: JobDescription[];
}) {
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [suggestions, setSuggestions] = useState<ResumeSuggestion[]>([]);
  const [draft, setDraft] = useState<StructuredCv | null>(null);
  const [editedProposals, setEditedProposals] = useState<Record<string, string>>({});
  const [userInputs, setUserInputs] = useState<Record<string, string>>({});
  const [sectionFilter, setSectionFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const selectedResume = resumes.find((resume) => resume.id === selectedResumeId);

  async function refreshPreview() {
    if (!selectedResumeId) {
      setDraft(null);
      setSuggestions([]);
      return;
    }
    const result = await getResumePreview(token, selectedResumeId);
    setDraft(result.structuredCv);
    setSuggestions(result.suggestions);
  }

  useEffect(() => {
    let active = true;
    if (!selectedResumeId) {
      setDraft(null);
      setSuggestions([]);
      return () => { active = false; };
    }
    setBusy(true);
    void getResumePreview(token, selectedResumeId).then((result) => {
      if (!active) return;
      setDraft(result.structuredCv);
      setSuggestions(result.suggestions);
      setNotice(null);
    }).catch((error: unknown) => {
      if (active) setNotice({ text: errorMessage(error), error: true });
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [token, selectedResumeId]);

  async function generate() {
    setNotice(null);
    if (!selectedResumeId || !jobId) {
      setNotice({ text: "Select a CV in Resume & role and choose a job description.", error: true });
      return;
    }
    setBusy(true);
    try {
      const accepted = await optimizeResume(token, selectedResumeId, jobId);
      await waitForJob(token, accepted.jobId);
      await refreshPreview();
      setNotice({ text: "Resume suggestions are ready for review.", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function decide(suggestion: ResumeSuggestion, decision: "accept" | "reject") {
    setBusy(true);
    setNotice(null);
    try {
      await decideSuggestion(token, suggestion.id, decision, {
        ...(decision === "accept" ? {
          proposedText: editedProposals[suggestion.id] ?? suggestion.proposedText,
          ...(userInputs[suggestion.id]?.trim() ? { userInput: userInputs[suggestion.id] } : {}),
        } : {}),
      });
      await refreshPreview();
      setNotice({ text: `Suggestion ${decision === "accept" ? "accepted" : "rejected"}; CV preview updated.`, error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function downloadDraft() {
    if (!selectedResumeId) return;
    const baseName = (selectedResume?.title || selectedResume?.originalFileName || "resume")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]+/g, "_");
    setDownloading(true);
    try {
      const documentBlob = await downloadResumeCv(token, selectedResumeId);
      const url = URL.createObjectURL(documentBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}-updated.docx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setDownloading(false);
    }
  }

  const sectionName = (suggestion: ResumeSuggestion) => suggestion.sectionTitle?.trim() || "Unplaced";
  const jobSuggestions = jobId
    ? suggestions.filter((suggestion) => suggestion.jobDescriptionId === jobId)
    : [];
  const sectionCounts = new Map<string, number>();
  for (const section of draft?.sections ?? []) {
    sectionCounts.set(section.heading.trim(), 0);
  }
  for (const suggestion of jobSuggestions) {
    const title = sectionName(suggestion);
    sectionCounts.set(title, (sectionCounts.get(title) ?? 0) + 1);
  }
  const availableSectionNames = [...sectionCounts.keys()];
  useEffect(() => {
    if (sectionFilter && !availableSectionNames.includes(sectionFilter)) {
      setSectionFilter("");
    }
  }, [jobId, sectionFilter, availableSectionNames.join("\u001f")]);

  const visibleSuggestions = jobSuggestions
    .filter((suggestion) => !sectionFilter || sectionName(suggestion) === sectionFilter)
    .sort((left, right) => {
      const leftIndex = draft?.sections.findIndex((section) => section.id === left.sectionId) ?? -1;
      const rightIndex = draft?.sections.findIndex((section) => section.id === right.sectionId) ?? -1;
      return leftIndex - rightIndex || left.createdAt.localeCompare(right.createdAt);
    });
  const acceptedCount = suggestions.filter((item) => item.status === "accepted").length;
  const appliedCount = suggestions.filter((item) =>
    item.status === "accepted" && item.applicationStatus === "applied").length;
  const attentionCount = suggestions.filter((item) =>
    item.applicationStatus === "needs_input" ||
    item.applicationStatus === "conflict" ||
    item.applicationStatus === "stale").length;
  const updatedSections = new Set(suggestions
    .filter((item) => item.status === "accepted" && item.applicationStatus === "applied" && item.sectionId)
    .map((item) => item.sectionId));

  return (
    <div className="workspace-panel">
      <h2>Resume improvement studio</h2>
      <p className="supporting-copy">
        Using CV: <strong>{selectedResume ? (selectedResume.title || selectedResume.originalFileName) : "Select or upload a CV in Resume & role"}</strong>
      </p>
      <div className="selector-grid">
        <label>Job description<select value={jobId} onChange={(event) => {
          setJobId(event.target.value);
          setSectionFilter("");
          setNotice(null);
        }}>
          <option value="">Select job</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.roleTitle || `Job ${job.id.slice(-6)}`}</option>)}
        </select></label>
        <button className="primary" type="button" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate suggestions"}</button>
      </div>
      {notice && <p className={`notice${notice.error ? " error" : ""}`} role="status" aria-live="polite">{notice.text}</p>}
      <p className="notice" role="status" aria-live="polite">
        {acceptedCount} accepted · {appliedCount} applied to your CV · {attentionCount} need attention
      </p>
      <div className="selector-grid">
        <label>Filter by section<select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} aria-label="Filter suggestions by CV section">
          <option value="">All sections</option>
          {[...sectionCounts.entries()].map(([title, count]) => (
            <option key={title} value={title}>{title} ({count})</option>
          ))}
        </select></label>
        <button className="secondary" type="button" disabled={downloading || !selectedResumeId} onClick={() => void downloadDraft()}>
          {downloading ? "Preparing Word document…" : "Download CV (.docx)"}
        </button>
      </div>
      {attentionCount > 0 && <p className="supporting-copy">Some accepted suggestions need attention before they can be included in the downloaded CV.</p>}
      {busy && <p className="supporting-copy" role="status">Loading or updating your CV…</p>}
      {visibleSuggestions.length === 0 ? (
        <p className="supporting-copy">{jobId ? "No suggestions for this CV and job yet." : "Choose a job description to review its suggestions."}</p>
      ) : (
        <div className="suggestion-list">
          {visibleSuggestions.map((suggestion) => (
            <article className="suggestion-card" key={suggestion.id}>
              <h3 className="suggestion-location">{suggestion.locationLabel ?? suggestion.sectionTitle ?? "CV section"}</h3>
              {isCoachReviewed(suggestion.reviewStatus) && <p className="reviewed-indicator">Reviewed by a coach</p>}
              {suggestion.reviewedOutput && <p className="feedback-output">{suggestion.reviewedOutput}</p>}
              <div className="comparison">
                <section><h3>Original</h3><blockquote>{suggestion.originalText}</blockquote></section>
                <section>
                  <h3>Proposed</h3>
                  <label htmlFor={`proposal-${suggestion.id}`} className="supporting-copy">Edit before accepting</label>
                  <textarea
                    id={`proposal-${suggestion.id}`}
                    value={editedProposals[suggestion.id] ?? suggestion.proposedText}
                    onChange={(event) => setEditedProposals((current) => ({ ...current, [suggestion.id]: event.target.value }))}
                    rows={4}
                  />
                </section>
              </div>
              <p><strong>Reason:</strong> {suggestion.reason}</p>
              {suggestion.jobRequirement && <p><strong>Job requirement:</strong> {suggestion.jobRequirement}</p>}
              <p className="supporting-copy">
                {suggestion.operation === "remove"
                  ? `Accepting removes this ${suggestion.field ?? "CV"} content.`
                  : suggestion.sectionId && draft?.sections.find((section) => section.id === suggestion.sectionId)?.type === "summary"
                    ? "Accepting replaces the whole Professional Summary."
                    : suggestion.entryId
                      ? "Accepting replaces this CV entry item."
                      : "Accepting replaces this section item."}
              </p>
              {suggestion.needsUserInput && (
                <label>Information needed before accepting
                  <textarea
                    value={userInputs[suggestion.id] ?? suggestion.userInput ?? ""}
                    onChange={(event) => setUserInputs((current) => ({ ...current, [suggestion.id]: event.target.value }))}
                    rows={2}
                  />
                </label>
              )}
              <div className="actions">
                <span className="status-chip">{suggestion.status === "pending" ? "Pending" : suggestion.status === "accepted" ? "Accepted" : "Rejected"}</span>
                <span className="status-chip">{suggestion.applicationStatus}</span>
                <button className="primary" type="button" disabled={busy || (Boolean(suggestion.needsUserInput) &&
                  !userInputs[suggestion.id]?.trim() &&
                  (editedProposals[suggestion.id] ?? suggestion.proposedText) === suggestion.proposedText)}
                  onClick={() => void decide(suggestion, "accept")}>Accept</button>
                <button className="secondary" type="button" disabled={busy} onClick={() => void decide(suggestion, "reject")}>Reject</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="result-section">
        <h3>CV preview</h3>
        {!draft ? <p className="supporting-copy" role="status">Select a CV to load its preview.</p> : (
          <div aria-live="polite">
            <p className="supporting-copy">This is the CV content included in the Word download.</p>
            {draft.header.name.trim() && <h4 className="cv-preview-name">{draft.header.name}</h4>}
            {[draft.header.headline, draft.header.phone, draft.header.email, draft.header.location, ...draft.header.links]
              .filter((value) => value.trim()).length > 0 && (
                <p className="cv-preview-contact">
                  {[draft.header.headline, draft.header.phone, draft.header.email, draft.header.location, ...draft.header.links]
                    .filter((value) => value.trim()).join(" | ")}
                </p>
              )}
            {getCvHeaderExtras(draft.header).map((line, index) => <p key={`header-${index}`}>{line}</p>)}
            {draft.sections.map((section) => (
              <section className={`result-section${updatedSections.has(section.id) ? " updated" : ""}`} key={section.id}>
                <h4>{section.heading}{updatedSections.has(section.id) ? " · Updated" : ""}</h4>
                {(section.type === "technical_skills" || section.type === "core_competencies") && section.groups.length > 0
                  ? section.groups.map((group) => (
                      <p key={group.id}>{group.label ? <><strong>{group.label}: </strong></> : null}{group.value}</p>
                    ))
                  : section.entries.length > 0
                    ? section.entries.map((entry) => (
                        <div key={entry.id}>
                          <p><strong>{[entry.title, entry.company, entry.location, entry.dates].filter(Boolean).join(" · ")}</strong></p>
                          {entry.lines.map((line) => <p key={line.id}>{line.kind === "bullet" ? "• " : ""}{line.text}</p>)}
                        </div>
                      ))
                    : section.paragraphs.map((line) => <p key={line.id}>{line.kind === "bullet" ? "• " : ""}{line.text}</p>)}
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InterviewSection({ token, resumes, selectedResumeId, jobs }: {
  token: string;
  resumes: Resume[];
  selectedResumeId: string;
  jobs: JobDescription[];
}) {
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [questionCount, setQuestionCount] = useState(5);
  const [interviewType, setInterviewType] = useState<InterviewType>("both");
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [questionSetId, setQuestionSetId] = useState("");
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [conversation, setConversation] = useState<Array<{ question: InterviewQuestion; answer: string }>>([]);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<InterviewEvaluation[] | null>(null);
  const [evaluationJobId, setEvaluationJobId] = useState("");
  const [evaluationRetry, setEvaluationRetry] = useState(0);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [autoRead, setAutoRead] = useState(false);
  const [voiceURI, setVoiceURI] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const speech = useInterviewSpeech();
  const recognition = useInterviewRecognition();
  const currentQuestion = session?.currentQuestion ?? null;
  const activeJob = jobs.find((job) => job.id === jobId);
  const selectedResume = resumes.find((resume) => resume.id === selectedResumeId);
  const sessionActive = session?.status === "in_progress" || session?.status === "evaluating";
  const feedbackText = evaluation ? evaluationSpeechText(evaluation) : "";
  const answerWithTranscript = joinAnswerText(answer, recognition.transcript, recognition.interimTranscript);

  useEffect(() => {
    if (autoRead && session?.status === "in_progress" && currentQuestion) {
      speech.speak(currentQuestion.text, voiceURI);
    }
  }, [autoRead, currentQuestion?.id, session?.status, speech.speak, voiceURI]);

  useEffect(() => {
    if (autoRead && feedbackText) speech.speak(feedbackText, voiceURI);
  }, [autoRead, feedbackText, speech.speak, voiceURI]);

  useEffect(() => {
    if (!session || session.status !== "evaluating") return;
    const evaluatingSession = session;
    let active = true;
    setEvaluationLoading(true);
    setNotice(null);

    async function loadFeedback() {
      try {
        if (evaluationJobId) {
          await waitForJob(token, evaluationJobId);
        } else {
          let completed = false;
          for (let attempt = 0; attempt < 30; attempt += 1) {
            await delay(1000);
            if (!active) return;
            const latest = await getInterview(token, evaluatingSession.id);
            if (latest.status === "completed") {
              completed = true;
              break;
            }
            if (latest.status !== "evaluating") {
              throw new Error("Interview evaluation stopped before feedback was ready.");
            }
          }
          if (!completed) {
            if (active) setNotice({ text: "Feedback is still processing. Check again shortly.", error: false });
            return;
          }
        }

        if (!active) return;
        const latest = await getInterview(token, evaluatingSession.id);
        if (latest.status !== "completed") throw new Error("Interview evaluation finished without a completed session.");
        const results = await getInterviewResults(token, evaluatingSession.id);
        if (results.evaluations.length === 0) throw new Error("The interview completed without feedback.");
        if (!active) return;
        setSession(latest);
        setEvaluation(results.evaluations);
        setEvaluationJobId("");
        setNotice({ text: "Interview feedback is ready.", error: false });
      } catch (error) {
        if (active) setNotice({ text: errorMessage(error), error: true });
      } finally {
        if (active) setEvaluationLoading(false);
      }
    }

    void loadFeedback();
    return () => { active = false; };
  }, [evaluationJobId, evaluationRetry, session?.id, session?.status, token]);

  async function generate() {
    if (!jobId) { setNotice({ text: "Select a job description.", error: true }); return; }
    speech.stop();
    recognition.stop();
    setBusy(true);
    setNotice(null);
    setQuestions([]);
    setQuestionSetId("");
    try {
      const accepted = await generateQuestions(token, jobId, selectedResumeId || undefined, questionCount, interviewType);
      const status = await waitForJob(token, accepted.jobId);
      if (!status.resultId) throw new Error("The question set is not ready yet.");
      const set = await getQuestionSet(token, status.resultId);
      if (set.questions.length === 0) throw new Error("No interview questions were generated. Try again.");
      setQuestions(set.questions);
      setQuestionSetId(set.id);
      setNotice({ text: `${set.questions.length} practice questions are ready.`, error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  function clearQuestionSet() {
    setQuestions([]);
    setQuestionSetId("");
    setNotice(null);
  }

  async function start() {
    if (!questionSetId || questions.length === 0) {
      setNotice({ text: "Generate a question set before starting the interview.", error: true });
      return;
    }
    speech.stop();
    recognition.stop();
    setBusy(true);
    setNotice(null);
    try {
      const started = await startInterview(token, { questionSetId });
      setSession(started);
      setConversation([]);
      setAnswer("");
      recognition.clearTranscript();
      setEvaluation(null);
      setEvaluationJobId("");
      setNotice({ text: "Mock interview started.", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (!session || !currentQuestion) return;
    const submittedAnswer = joinAnswerText(answer, recognition.transcript).trim();
    if (!submittedAnswer) return;
    speech.stop();
    recognition.stop();
    recognition.clearTranscript();
    setBusy(true);
    setNotice(null);
    try {
      const result = await answerInterview(token, session.id, submittedAnswer, session.currentIndex);
      setConversation((current) => [...current, { question: currentQuestion, answer: submittedAnswer }]);
      setAnswer("");
      if (result.nextQuestion) {
        setSession({
          ...session,
          currentIndex: result.nextQuestion.index,
          currentQuestion: result.nextQuestion,
        });
      } else if (result.status === "completed" && result.evaluation) {
        setSession({ ...session, currentIndex: session.currentIndex + 1, status: "completed", currentQuestion: null });
        setEvaluation([result.evaluation]);
        setNotice({ text: "Interview feedback is ready.", error: false });
      } else if (result.status === "evaluating") {
        setSession({ ...session, currentIndex: session.currentIndex + 1, status: "evaluating", currentQuestion: null });
        setEvaluationJobId("");
        setNotice({ text: "Your answers are saved. Preparing feedback…", error: false });
      } else {
        throw new Error("The interview response did not include the next question or feedback.");
      }
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!session || conversation.length === 0) return;
    speech.stop();
    recognition.stop();
    recognition.clearTranscript();
    setBusy(true);
    setNotice(null);
    try {
      const accepted = await evaluateInterview(token, session.id);
      setEvaluationJobId(accepted.jobId);
      setSession({ ...session, status: "evaluating", currentQuestion: null });
      setNotice({ text: "Your answers are saved. Preparing feedback…", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  function startAnotherInterview() {
    speech.stop();
    recognition.stop();
    recognition.clearTranscript();
    setSession(null);
    setConversation([]);
    setAnswer("");
    setEvaluation(null);
    setEvaluationJobId("");
    setNotice(null);
  }

  function startRecording() {
    setAnswer(joinAnswerText(answer, recognition.transcript));
    recognition.clearTranscript();
    speech.stop();
    recognition.start();
  }

  function stopRecording() {
    recognition.stop();
  }

  return (
    <div className="workspace-grid">
      <section className="workspace-panel interview-setup" aria-label="Interview setup">
        <h2>Prepare for an interview</h2>
        <p className="supporting-copy">Choose the interview style. Questions use your selected role and shared CV; the AI chooses each question’s difficulty.</p>
        {jobs.length === 0 ? (
          <p className="interview-empty-state" role="status">Add a job description in Resume &amp; role before generating interview questions.</p>
        ) : (
          <div className="interview-options">
          <label htmlFor="interview-job">Job description</label>
          <select id="interview-job" value={jobId} disabled={Boolean(sessionActive) || busy} onChange={(event) => {
            setJobId(event.target.value);
            clearQuestionSet();
          }}>
            <option value="">Select job</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.roleTitle || `Job ${job.id.slice(-6)}`}</option>)}
          </select>
          <label htmlFor="interview-type">Interview type</label>
          <select id="interview-type" value={interviewType} disabled={Boolean(sessionActive) || busy} onChange={(event) => {
            const nextType = parseInterviewType(event.target.value);
            if (!nextType) {
              setNotice({ text: "Choose a valid interview type.", error: true });
              return;
            }
            setInterviewType(nextType);
            if (nextType === "both") setQuestionCount((count) => Math.max(2, count));
            clearQuestionSet();
          }}>
            <option value="technical">Technical</option>
            <option value="behavioral">Behavioural</option>
            <option value="both">Both</option>
          </select>
          <p className="interview-resume-context">
            Using CV: <strong>{selectedResume ? (selectedResume.title || selectedResume.originalFileName) : "None — choose or upload one in Resume & role"}</strong>
          </p>
          <label htmlFor="interview-question-count">Number of questions</label>
          <input
            id="interview-question-count"
            type="number"
            min={interviewType === "both" ? 2 : 1}
            max={20}
            value={questionCount}
            disabled={Boolean(sessionActive) || busy}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value)) {
                setQuestionCount(Math.min(20, Math.max(interviewType === "both" ? 2 : 1, value)));
                clearQuestionSet();
              }
            }}
          />
          <button className="secondary" type="button" disabled={busy || Boolean(sessionActive) || !jobId} onClick={() => void generate()}>
            {busy ? "Generating…" : "Generate interview questions"}
          </button>
          </div>
        )}
        {questions.length > 0 && (
          <details className="interview-question-bank">
            <summary>{questions.length} generated questions</summary>
            <ol>
            {questions.map((question) => <li key={question.id}><strong>{interviewQuestionTypeLabel(question.type)} · {question.category} · {question.difficulty}</strong><p>{question.text}</p></li>)}
            </ol>
          </details>
        )}
        <fieldset className="interview-speech-settings">
          <legend>Interviewer voice</legend>
          <label className="interview-checkbox">
            <input
              type="checkbox"
              checked={autoRead}
              disabled={!speech.available}
              onChange={(event) => {
                if (!event.target.checked) speech.stop();
                setAutoRead(event.target.checked);
              }}
            />
            Auto-read questions and feedback
          </label>
          {speech.voices.length > 0 && (
            <label htmlFor="interview-voice">
              Voice
              <select id="interview-voice" value={voiceURI} onChange={(event) => setVoiceURI(event.target.value)}>
                <option value="">Browser default</option>
                {speech.voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang}){voice.default ? " · default" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="interview-speech-status" role="status" aria-live="polite">
            {speech.error ?? (speech.available
              ? "Speech is optional; all questions and feedback remain available as text."
              : "Speech synthesis is unavailable in this browser. You can still read and answer questions.")}
          </p>
        </fieldset>
      </section>
      <section className="workspace-panel interview-room" aria-label="Interview practice">
        <h2>AI interviewer</h2>
        {activeJob && <p className="interview-role-context">Practice for <strong>{activeJob.roleTitle || "your selected role"}</strong></p>}
        {notice && <p className={`notice${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"} aria-live="polite">{notice.text}</p>}
        {session ? (
          <>
            <div className="interview-progress">
              <div><span>Interview progress</span><strong>{conversation.length} of {questions.length} answered</strong></div>
              <progress
                aria-label={`Interview questions answered: ${conversation.length} of ${questions.length}`}
                max={Math.max(questions.length, 1)}
                value={conversation.length}
              >
                {conversation.length} of {questions.length}
              </progress>
            </div>
            {conversation.length > 0 && (
              <div className="interview-transcript" aria-label="Conversation so far">
                {conversation.map((entry, index) => (
                  <article className="interview-exchange" key={`${entry.question.id}-${index}`}>
                    <p className="interview-speaker">Interviewer · {index + 1}</p>
                    <p className="interview-transcript-question">{entry.question.text}</p>
                    <p className="interview-speaker">Your answer</p>
                    <p className="interview-transcript-answer">{entry.answer}</p>
                  </article>
                ))}
              </div>
            )}
            {session.status === "in_progress" && currentQuestion ? (
              <>
                <article className="interview-current-question" aria-live="polite">
                  <p className="eyebrow">Question {session.currentIndex + 1} of {questions.length}</p>
                  <p className="interview-question-meta">{interviewQuestionTypeLabel(currentQuestion.type)} <span>·</span> {currentQuestion.category} <span>·</span> {currentQuestion.difficulty} difficulty</p>
                  <h3>{currentQuestion.text}</h3>
                  <SpeechControls speech={speech} text={currentQuestion.text} voiceURI={voiceURI} label="question" />
                </article>
                <p className="interview-answer-guidance">
                  {currentQuestion.type === "technical"
                    ? "Type your technical answer and explain your approach."
                    : "Record your behavioural answer for transcription, or type it below."}
                </p>
                <label className="interview-answer-label" htmlFor="interview-answer">Your answer</label>
                <textarea
                  id="interview-answer"
                  rows={7}
                  maxLength={20000}
                  value={answerWithTranscript}
                  readOnly={recognition.isListening}
                  onChange={(event) => {
                    recognition.clearTranscript();
                    setAnswer(event.target.value);
                  }}
                  placeholder={currentQuestion.type === "technical"
                    ? "Type your technical answer, approach, and reasoning…"
                    : "Record your answer or type it here…"}
                />
                <div className="interview-recognition-controls">
                  <button
                    className="secondary"
                    type="button"
                    disabled={!recognition.available || recognition.isListening || busy}
                    onClick={startRecording}
                  >
                    Record answer
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={!recognition.isListening || busy}
                    onClick={stopRecording}
                  >
                    Stop recording
                  </button>
                  <p role="status" aria-live="polite">
                    {recognition.error ?? (recognition.available
                      ? "Speech-to-text uses your browser’s speech service; microphone access may be requested."
                      : "Speech-to-text is unavailable in this browser. You can type your answer.")}
                  </p>
                </div>
                <div className="actions">
                  <button className="primary" type="button" disabled={busy || recognition.isListening || !joinAnswerText(answer, recognition.transcript).trim()} onClick={() => void submitAnswer()}>{busy ? "Submitting…" : "Submit answer"}</button>
                  <button className="secondary" type="button" disabled={busy || recognition.isListening || conversation.length === 0 || Boolean(joinAnswerText(answer, recognition.transcript).trim())} onClick={() => void finish()}>Finish and get feedback</button>
                </div>
                {joinAnswerText(answer, recognition.transcript).trim() && <p className="supporting-copy">Submit or clear your current answer before finishing; unsent text is not included in feedback.</p>}
              </>
            ) : session.status === "evaluating" ? (
              <>
                <p className="interview-evaluation-state" role="status" aria-live="polite">
                  {evaluationLoading ? "Reviewing your answers and preparing feedback…" : "Your interview is complete. Feedback is still processing."}
                </p>
                {!evaluationLoading && (
                  <button className="secondary" type="button" onClick={() => setEvaluationRetry((count) => count + 1)}>
                    Check feedback
                  </button>
                )}
              </>
            ) : session.status === "completed" ? (
              <button className="secondary" type="button" onClick={startAnotherInterview}>Start another practice interview</button>
            ) : (
              <p className="supporting-copy">This session is no longer accepting answers. Start a new practice interview when ready.</p>
            )}
            {evaluation && (
              <EvaluationReport
                evaluations={evaluation}
                speech={speech}
                voiceURI={voiceURI}
                speechText={feedbackText}
              />
            )}
          </>
        ) : (
          <div className="interview-empty-state">
            <p className="eyebrow">Practice session</p>
            <h3>One question at a time</h3>
            <p>Choose a job description, generate questions, then begin your practice session.</p>
            <button className="primary" type="button" disabled={busy || !questionSetId || questions.length === 0} onClick={() => void start()}>
              {busy ? "Starting…" : "Start interview"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

type InterviewSpeech = ReturnType<typeof useInterviewSpeech>;

function SpeechControls({
  speech,
  text,
  voiceURI,
  label,
}: {
  speech: InterviewSpeech;
  text: string;
  voiceURI: string;
  label: string;
}) {
  return (
    <div className="interview-speech-controls">
      <button className="secondary" type="button" disabled={!speech.available || !text.trim()} onClick={() => speech.speak(text, voiceURI)}>
        Speak {label}
      </button>
      <button className="secondary" type="button" disabled={!speech.isSpeaking} onClick={speech.stop}>
        Stop speaking
      </button>
    </div>
  );
}

function evaluationSpeechText(evaluations: InterviewEvaluation[]) {
  return evaluations.map((evaluation) => [
    `Overall score: ${evaluation.overallScore} percent.`,
    `Strengths: ${evaluation.strengths.join(". ") || "No specific strengths recorded."}.`,
    `Improvement areas and next steps: ${evaluation.improvements.join(". ") || "No specific improvement areas recorded."}.`,
    evaluation.exampleAnswer ? `Example answer: ${evaluation.exampleAnswer}` : "",
  ].filter(Boolean).join(" ")).join(" ");
}

function joinAnswerText(...parts: string[]) {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

function interviewQuestionTypeLabel(type?: InterviewQuestion["type"]) {
  if (type === "technical") return "Technical";
  if (type === "behavioral") return "Behavioural";
  return "Interview";
}

function parseInterviewType(value: string): InterviewType | null {
  if (value === "technical" || value === "behavioral" || value === "both") return value;
  return null;
}

function EvaluationReport({
  evaluations,
  speech,
  voiceURI,
  speechText,
}: {
  evaluations: InterviewEvaluation[];
  speech: InterviewSpeech;
  voiceURI: string;
  speechText: string;
}) {
  return (
    <section className="result-section interview-feedback" aria-label="Interview feedback">
      <div className="interview-feedback-heading">
        <div>
          <p className="eyebrow">AI-generated feedback · coach review where flagged</p>
          <h2>Your interview feedback</h2>
        </div>
        <SpeechControls speech={speech} text={speechText} voiceURI={voiceURI} label="feedback" />
      </div>
      {evaluations.map((evaluation, index) => (
        <article key={evaluation.rubricVersion + index}>
          <h3>Overall score: {evaluation.overallScore}%</h3>
          <p className="supporting-copy">
            AI confidence: {Math.round(evaluation.confidence * 100)}% · Review status: {evaluation.reviewStatus.replaceAll("_", " ")}
          </p>
          {isCoachReviewed(evaluation.reviewStatus) && <p className="reviewed-indicator">Reviewed by a coach</p>}
          {evaluation.reviewedOutput && <p className="feedback-output">{evaluation.reviewedOutput}</p>}
          <h3>Feedback by skill</h3>
          <div className="score-grid">
            {evaluation.dimensionFeedback.map((dimension) => (
              <div key={dimension.dimension}>
                <span>{dimension.dimension}</span>
                <strong>{dimension.score}/4</strong>
                <small>{dimension.feedback}</small>
              </div>
            ))}
          </div>
          <h3>Strengths</h3>
          <SkillList items={evaluation.strengths} />
          <h3>Improvement areas and actionable next steps</h3>
          <SkillList items={evaluation.improvements} />
          {evaluation.exampleAnswer && <><h3>Example answer</h3><blockquote>{evaluation.exampleAnswer}</blockquote></>}
        </article>
      ))}
    </section>
  );
}

function SkillList({ items }: { items: string[] }) {
  return items.length > 0 ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="supporting-copy">None recorded.</p>;
}

async function waitForJob(token: string, jobId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await getJobStatus(token, jobId);
    if (status.status === "succeeded") return status;
    if (status.status === "failed") {
      throw new Error(status.error?.code === "SERVICE_UNAVAILABLE"
        ? "The required local service is unavailable."
        : status.error?.code === "AI_SERVICE_ERROR"
          ? "The AI service could not complete the job. Please try again."
        : "The background AI job failed. Please try again.");
    }
    await delay(1000);
  }
  throw new Error("The background job is still processing. Check it again shortly.");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getCvHeaderExtras(header: StructuredCv["header"]): string[] {
  const known = new Set([
    ...[header.headline, header.phone, header.email, header.location, ...header.links].map(normalizeHeaderValue),
    ...(header.name.trim() ? [normalizeHeaderValue(header.name)] : []),
  ]);
  return header.sourceLines.flatMap((line) => line.text.split(/[|•·]/))
    .map((value) => value.trim())
    .filter((value) => value && !known.has(normalizeHeaderValue(value)));
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function isCoachReviewed(status: string): boolean {
  return status === "approved" || status === "edited" || status === "rejected";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}
