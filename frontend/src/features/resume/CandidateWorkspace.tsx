import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  analyzeMatch,
  analyzeSkillGaps,
  answerInterview,
  decideSuggestion,
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
  getResumeDraft,
  getResumes,
  getResumeSuggestions,
  getSkillGaps,
  optimizeResume,
  startInterview,
  submitJobDescription,
  updateResume,
  uploadResume,
  type CandidateProgress,
  type ConsentStatus,
  type InterviewEvaluation,
  type InterviewQuestion,
  type InterviewSession,
  type JobDescription,
  type MatchResult,
  type Resume,
  type ResumeSuggestion,
  type SkillGapResult,
} from "../../api/client";

interface Props {
  token: string;
  email: string;
  onWithdraw: () => Promise<void>;
  onConsentRejected: () => Promise<void>;
}

type Tab = "dashboard" | "resume" | "jobs" | "match" | "studio" | "interview" | "privacy";

const workspaceNavigation: Array<{ label: string; tabs: Tab[] }> = [
  { label: "Overview", tabs: ["dashboard"] },
  { label: "Resume & role", tabs: ["resume", "jobs"] },
  { label: "Match & coaching", tabs: ["match", "studio"] },
  { label: "Interview practice", tabs: ["interview"] },
  { label: "Privacy & settings", tabs: ["privacy"] },
];

export default function CandidateWorkspace({ token, email, onWithdraw, onConsentRejected, onSignOut }: Props & { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [progress, setProgress] = useState<CandidateProgress | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
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
          <button className="signout-button" type="button" aria-label="Sign out" onClick={onSignOut}>↪</button>
        </div>
      </aside>

      <div className="candidate-main-shell">
        <header className="candidate-topbar">
          <p>Workspace <span>/</span> {activeSection}</p>
          <span className="private-session"><i /> Private session</span>
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
                      <ResumeSection token={token} resumes={resumes} onChanged={refreshData} onConsentRejected={onConsentRejected} />
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
                      ? <MatchSection token={token} resumes={resumes} jobs={jobs} />
                      : <StudioSection token={token} resumes={resumes} jobs={jobs} />}
                  </>
                )}
                {tab === "interview" && (
                  <>
                    <WorkspacePageHeading
                      eyebrow="Interview practice"
                      title="Practise with a little more confidence."
                      description="Build questions for a role, practise one answer at a time, and review actionable feedback."
                    />
                    <InterviewSection token={token} resumes={resumes} jobs={jobs} />
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
          <div><span>Latest practice score</span><strong>{practiceScore ? `${practiceScore}%` : "—"}</strong><small>Complete an interview to get feedback</small></div>
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
  if (purpose === "resume_processing") return "CV processing";
  if (purpose === "external_model_processing") return "External AI processing";
  return purpose.replaceAll("_", " ");
}

function ResumeSection({ token, resumes, onChanged, onConsentRejected }: {
  token: string;
  resumes: Resume[];
  onChanged: () => Promise<void>;
  onConsentRejected: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState(resumes[0]?.id ?? "");
  const [selected, setSelected] = useState<Resume | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let active = true;
    void getResume(token, selectedId).then((result) => {
      if (!active) return;
      setSelected(result.resume);
      setTitle(result.resume.title ?? "");
      setNotes(result.resume.notes ?? "");
    }).catch((error: unknown) => {
      if (active) setNotice({ text: errorMessage(error), error: true });
    });
    return () => { active = false; };
  }, [token, selectedId]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await uploadResume(token, file);
      setSelectedId(result.resume.id);
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
    if (!selectedId) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateResume(token, selectedId, { title: title.trim() || undefined, notes: notes.trim() });
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
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="Select CV">
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

function MatchSection({ token, resumes, jobs }: { token: string; resumes: Resume[]; jobs: JobDescription[] }) {
  const [resumeId, setResumeId] = useState(resumes[0]?.id ?? "");
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [gaps, setGaps] = useState<SkillGapResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    if (!resumeId || !jobId) {
      setNotice({ text: "Select both a CV and a job description.", error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    setMatch(null);
    setGaps(null);
    try {
      const [matchJob, gapJob] = await Promise.all([
        analyzeMatch(token, resumeId, jobId),
        analyzeSkillGaps(token, resumeId, jobId),
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
      <div className="selector-grid">
        <label>CV<select value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
          <option value="">Select CV</option>
          {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title || resume.originalFileName}</option>)}
        </select></label>
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

function StudioSection({ token, resumes, jobs }: { token: string; resumes: Resume[]; jobs: JobDescription[] }) {
  const [resumeId, setResumeId] = useState(resumes[0]?.id ?? "");
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [suggestions, setSuggestions] = useState<ResumeSuggestion[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void getResumeSuggestions(token).then((result) => {
      if (active) setSuggestions(result.items);
    }).catch((error: unknown) => {
      if (active) setNotice({ text: errorMessage(error), error: true });
    });
    return () => { active = false; };
  }, [token]);

  async function generate() {
    if (!resumeId || !jobId) {
      setNotice({ text: "Select both a CV and a job description.", error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const accepted = await optimizeResume(token, resumeId, jobId);
      await waitForJob(token, accepted.jobId);
      const result = await getResumeSuggestions(token);
      setSuggestions(result.items);
      setDraft(null);
      setNotice({ text: "Resume suggestions are ready for review.", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: "accept" | "reject") {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await decideSuggestion(token, id, decision);
      setSuggestions((current) => current.map((item) => item.id === id ? updated : item));
      setDraft(null);
      setNotice({ text: `Suggestion ${decision === "accept" ? "accepted" : "rejected"}.`, error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function generateDraft() {
    if (!resumeId || !jobId) {
      setNotice({ text: "Select both a CV and a job description.", error: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await getResumeDraft(token, resumeId, jobId);
      setDraft(result.content);
      setNotice({
        text: `${result.appliedSuggestionIds.length} accepted suggestion${result.appliedSuggestionIds.length === 1 ? "" : "s"} applied to the CV draft.`,
        error: false,
      });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  function downloadDraft() {
    if (draft === null) return;
    const selectedResume = resumes.find((resume) => resume.id === resumeId);
    const baseName = (selectedResume?.title || selectedResume?.originalFileName || "resume")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]+/g, "_");
    const url = URL.createObjectURL(new Blob([draft], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}-draft.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const visibleSuggestions = suggestions.filter((suggestion) =>
    suggestion.resumeId === resumeId && suggestion.jobDescriptionId === jobId);

  return (
    <div className="workspace-panel">
      <h2>Resume improvement studio</h2>
      <div className="selector-grid">
        <label>CV<select value={resumeId} onChange={(event) => { setResumeId(event.target.value); setDraft(null); }}>
          <option value="">Select CV</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title || resume.originalFileName}</option>)}
        </select></label>
        <label>Job description<select value={jobId} onChange={(event) => { setJobId(event.target.value); setDraft(null); }}>
          <option value="">Select job</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.roleTitle || `Job ${job.id.slice(-6)}`}</option>)}
        </select></label>
        <button className="primary" type="button" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate suggestions"}</button>
      </div>
      {notice && <p className={`notice${notice.error ? " error" : ""}`}>{notice.text}</p>}
      {visibleSuggestions.length === 0 ? <p className="supporting-copy">No resume suggestions yet for this CV.</p> : (
        <div className="suggestion-list">
          {visibleSuggestions.map((suggestion) => (
            <article className="suggestion-card" key={suggestion.id}>
              <div className="comparison">
                <section><h3>Original</h3><blockquote>{suggestion.originalText}</blockquote></section>
                <section><h3>Proposed</h3><blockquote>{suggestion.proposedText}</blockquote></section>
              </div>
              <p><strong>Reason:</strong> {suggestion.reason}</p>
              <p className="supporting-copy">Status: {suggestion.status} · Review: {suggestion.reviewStatus}</p>
              {suggestion.status === "pending" && (
                <div className="actions">
                  <button className="primary" type="button" disabled={busy} onClick={() => void decide(suggestion.id, "accept")}>Accept</button>
                  <button className="secondary" type="button" disabled={busy} onClick={() => void decide(suggestion.id, "reject")}>Reject</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <section className="result-section">
        <h3>CV draft</h3>
        <p className="supporting-copy">Only accepted suggestions for this CV are applied. Pending and rejected suggestions are left out.</p>
        <div className="actions">
          <button className="secondary" type="button" disabled={busy || !resumeId || !jobId} onClick={() => void generateDraft()}>
            {busy ? "Preparing…" : "Generate CV draft"}
          </button>
          {draft !== null && <button className="secondary" type="button" onClick={downloadDraft}>Download draft</button>}
        </div>
        {draft !== null && <pre className="source-preview">{draft}</pre>}
      </section>
    </div>
  );
}

function InterviewSection({ token, resumes, jobs }: { token: string; resumes: Resume[]; jobs: JobDescription[] }) {
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [resumeId, setResumeId] = useState(resumes[0]?.id ?? "");
  const [questionCount, setQuestionCount] = useState(5);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [questionSetId, setQuestionSetId] = useState("");
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<InterviewEvaluation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  async function generate() {
    if (!jobId) { setNotice({ text: "Select a job description.", error: true }); return; }
    setBusy(true);
    setNotice(null);
    try {
      const accepted = await generateQuestions(token, jobId, resumeId || undefined, questionCount);
      const status = await waitForJob(token, accepted.jobId);
      if (!status.resultId) throw new Error("The question set is not ready yet.");
      const set = await getQuestionSet(token, status.resultId);
      setQuestions(set.questions);
      setQuestionSetId(set.id);
      setNotice({ text: `${set.questions.length} preparation questions generated.`, error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!jobId && questions.length === 0) { setNotice({ text: "Generate questions or select a job description.", error: true }); return; }
    setBusy(true);
    setNotice(null);
    setEvaluation(null);
    try {
      const started = await startInterview(token, questions.length > 0
        ? { questionSetId }
        : { jobDescriptionId: jobId });
      setSession(started);
      setAnswer("");
      setNotice({ text: "Mock interview started.", error: false });
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (!session || !answer.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await answerInterview(token, session.id, answer.trim(), session.currentIndex);
      setAnswer("");
      if (result.nextQuestion) {
        setSession(await getInterview(token, session.id));
      } else if (result.status === "completed" && result.evaluation) {
        setSession({ ...session, status: "completed", currentQuestion: null });
        setEvaluation([result.evaluation]);
        setNotice({ text: "Interview evaluation completed.", error: false });
      } else if (result.status === "evaluating") {
        setSession({ ...session, status: "evaluating", currentQuestion: null });
        setNotice({ text: "Final evaluation has been queued.", error: false });
      }
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!session) return;
    setBusy(true);
    setNotice(null);
    try {
      let latest = await getInterview(token, session.id);
      let accepted: Awaited<ReturnType<typeof evaluateInterview>> | null = null;
      if (latest.status === "in_progress") {
        accepted = await evaluateInterview(token, session.id);
      }
      for (let attempt = 0; attempt < 30 && latest.status !== "completed"; attempt += 1) {
        await delay(1000);
        latest = await getInterview(token, session.id);
        if (accepted?.jobId) await getJobStatus(token, accepted.jobId).catch(() => undefined);
      }
      if (latest.status === "completed") {
        const results = await getInterviewResults(token, session.id);
        setEvaluation(results.evaluations);
        setSession(latest);
        setNotice({ text: "Interview evaluation completed.", error: false });
      } else {
        setNotice({ text: "Evaluation is still in progress. Refresh the session later.", error: false });
      }
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-grid">
      <section className="workspace-panel">
        <h2>Prepare for an interview</h2>
        <div className="form-stack">
          <label>Job description<select value={jobId} onChange={(event) => setJobId(event.target.value)}>
            <option value="">Select job</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.roleTitle || `Job ${job.id.slice(-6)}`}</option>)}
          </select></label>
          <label>CV (optional)<select value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
            <option value="">No CV</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title || resume.originalFileName}</option>)}
          </select></label>
          <label>Question count<input type="number" min={1} max={20} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} /></label>
          <button className="secondary" type="button" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate question bank"}</button>
        </div>
        {questions.length > 0 && (
          <ol className="question-bank">
            {questions.map((question) => <li key={question.id}><strong>{question.category} · {question.difficulty}</strong><p>{question.text}</p></li>)}
          </ol>
        )}
      </section>
      <section className="workspace-panel" aria-live="polite">
        <h2>Mock interview room</h2>
        {session ? (
          <>
            <p className="supporting-copy">Session status: {session.status} · Question {session.currentIndex + 1}</p>
            {session.status === "in_progress" && session.currentQuestion ? (
              <>
                <h3>{session.currentQuestion.text}</h3>
                <textarea rows={7} maxLength={20000} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer…" />
                <div className="actions">
                  <button className="primary" type="button" disabled={busy || !answer.trim()} onClick={() => void submitAnswer()}>{busy ? "Submitting…" : "Submit answer"}</button>
                  <button className="secondary" type="button" disabled={busy} onClick={() => void finish()}>Finish and evaluate</button>
                </div>
              </>
            ) : session.status === "evaluating" ? (
              <>
                <p>Evaluation is in progress. It may take a moment.</p>
                <button className="secondary" type="button" disabled={busy} onClick={() => void finish()}>Check evaluation</button>
              </>
            ) : null}
          </>
        ) : (
          <button className="primary" type="button" disabled={busy || (!jobId && questions.length === 0)} onClick={() => void start()}>{busy ? "Starting…" : "Start mock interview"}</button>
        )}
        {notice && <p className={`notice${notice.error ? " error" : ""}`}>{notice.text}</p>}
        {evaluation && <EvaluationReport evaluations={evaluation} />}
      </section>
    </div>
  );
}

function EvaluationReport({ evaluations }: { evaluations: InterviewEvaluation[] }) {
  return (
    <section className="result-section">
      <p className="eyebrow">AI-generated · reviewed by coach where flagged</p>
      {evaluations.map((evaluation, index) => (
        <article key={evaluation.rubricVersion + index}>
          <h2>Overall score: {evaluation.overallScore}%</h2>
          <h3>Rubric</h3>
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
          <h3>Improvements</h3>
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
        : "The background AI job failed. Please try again.");
    }
    await delay(1000);
  }
  throw new Error("The background job is still processing. Check it again shortly.");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}
