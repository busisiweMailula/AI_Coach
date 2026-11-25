export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export type UserRole = "candidate" | "coach" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  status: "active" | "disabled";
  createdAt: string;
}

export interface RegistrationResponse {
  user: AuthUser;
}

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuditLog {
  id: string;
  actorEmail: string | null;
  subjectEmail: string | null;
  action: string;
  targetType: string | null;
  previousRole: string | null;
  newRole: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  createdAt: string;
  requestId: string | null;
}

export interface ReviewItem {
  id: string;
  targetType: "job_match" | "resume_suggestion" | "interview_evaluation";
  targetId: string;
  flags: string[];
  riskLevel: "low" | "medium" | "high";
  status: "pending_review" | "in_review" | "approved" | "edited" | "rejected" | "withdrawn";
  assignedCoachId: string | null;
  claimedAt?: string | null;
  requestReason: string | null;
  decisionReason: string | null;
  decisionText: string | null;
  modifiedOutput?: string | null;
  recommendations?: string[];
  decidedBy?: string | null;
  decidedAt?: string | null;
  internalNote?: string | null;
  candidate?: { displayName: string; email: string };
  jobTitle?: string | null;
  resumeName?: string | null;
  flagReasons?: string[];
  waitingSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export type CoachReviewTarget =
  | {
      type: "job_match";
      score: number;
      scoreBreakdown: Record<string, number>;
      skillResults: Array<{ name: string; status: string; evidenceSnippet?: string }>;
      disclaimer: string;
      flags: string[];
      confidence: number;
      reviewedOutput?: string;
    }
  | {
      type: "resume_suggestion";
      originalText: string;
      proposedText: string;
      reason: string;
      sourceSnippet: string;
      jobRequirement?: string;
      reviewedOutput?: string;
    }
  | {
      type: "interview_evaluation";
      overallScore: number;
      dimensions: Array<{ dimension: string; score: number; feedback: string }>;
      strengths: string[];
      improvements: string[];
      exampleAnswer: string | null;
      confidence: number;
      answers: Array<{ question: string; answer: string }>;
      reviewedOutput?: string;
    };

export interface CoachReviewDetails {
  review: ReviewItem;
  target: CoachReviewTarget;
  candidate: { id: string; displayName: string; email: string; registeredAt: string };
  job: { title: string; company: string | null; text: string; createdAt: string } | null;
  resume: {
    id: string;
    fileName: string;
    title: string | null;
    createdAt: string;
    extractedText: string;
    structuredCv: StructuredCv | null;
    fileLink: string;
  } | null;
  history: Array<{ action: string; actor: string; createdAt: string; details: string | null }>;
}

export interface CandidateCoachFeedback {
  review: ReviewItem;
  coachName: string;
  decisionLabel: "Approved" | "Modified" | "Rejected";
  reason: string | null;
  recommendations: string[];
  originalOutput: string | null;
  modifiedOutput: string | null;
  target: CoachReviewTarget;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  readAt: string | null;
}

export interface AdminDashboard {
  usersByRole: Record<UserRole, { total: number; active: number; disabled: number }>;
  registrations: {
    last7Days: number;
    last30Days: number;
    dailyTrend: Array<{ date: string; count: number }>;
  };
  reviewQueue: {
    pending: number;
    inReview: number;
    oldestWaitingAt: string | null;
    completedThisWeek: number;
    averageTurnaroundMinutes: number | null;
  };
  contentCounts: { cvs: number; jobs: number; matches: number };
  recentAudit: Array<{ id: string; actorEmail: string | null; action: string; createdAt: string }>;
}

export interface ConsentStatus {
  purpose: string;
  policyVersion: string;
  accepted: boolean;
}

export type ConsentPurpose = "resume_processing" | "external_model_processing" | "human_review";

export interface ResumeUploadResponse {
  resume: {
    id: string;
    originalFileName: string;
    textExtractionStatus: string;
    parseStatus: string;
    parseJobId?: string;
  };
}

export interface Resume {
  id: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  textExtractionStatus: string;
  parseStatus: string;
  parseJobId?: string;
  title?: string;
  notes?: string;
  extractedText?: string;
  parsedData?: unknown;
  createdAt: string;
  updatedAt: string;
}

export type ResumeSectionType =
  | "summary" | "core_competencies" | "technical_skills" | "experience" | "projects"
  | "education" | "certifications" | "additional_information" | "references" | "custom";

export interface StructuredCvLine {
  id: string;
  text: string;
  kind: "paragraph" | "bullet" | "date";
  bold?: boolean;
}

export interface StructuredCvSection {
  id: string;
  type: ResumeSectionType;
  subtype?: string;
  heading: string;
  paragraphs: StructuredCvLine[];
  groups: Array<{ id: string; sourceLineId: string; label: string; value: string }>;
  entries: Array<{
    id: string;
    title: string;
    dates: string;
    company: string;
    location: string;
    lines: StructuredCvLine[];
  }>;
}

export interface StructuredCv {
  header: {
    name: string;
    headline: string;
    phone: string;
    email: string;
    location: string;
    links: string[];
    sourceLines: StructuredCvLine[];
  };
  sections: StructuredCvSection[];
  lossless: { coverage: number; verified: boolean };
}

export interface ResumeSuggestionTarget {
  sectionType: ResumeSectionType;
  sectionSubtype?: string;
  entryId?: string;
  bulletId?: string;
  field: "text" | "title" | "company" | "location" | "dates" | "objective" | "technologies" | "contribution" | "outcome";
  operation: "replace";
  before: string;
  after: string;
}

export interface DraftSuggestion {
  id: string;
  originalText: string;
  proposedText: string;
  target: ResumeSuggestionTarget | null;
  sectionTitle?: string;
  locationLabel?: string;
  applicationStatus?: "applied" | "conflict" | "needs_input" | "stale" | "not_applied";
}

export interface ResumeDraftResponse {
  resumeId: string;
  jobDescriptionId: string | null;
  structuredCv: StructuredCv;
  acceptedSuggestions: DraftSuggestion[];
  suggestions: ResumeSuggestion[];
}

export interface JobDescription {
  id: string;
  sourceType: "paste" | "upload";
  analysisStatus: string;
  createdAt: string;
  roleTitle?: string;
  requiredSkills?: Array<{ name: string; evidenceSnippet: string }>;
  preferredSkills?: Array<{ name: string; evidenceSnippet: string }>;
  responsibilities?: Array<{ text: string; evidenceSnippet: string }>;
  analyzerVersion?: string;
  text?: string;
}

export interface CandidateProgress {
  completedInterviews: number;
  completedEvaluations: number;
  averageRubricScores: Record<string, number>;
  skillGapCount: number;
  updatedAt: string;
}

export interface AcceptedJob {
  jobId: string;
  status: string;
  statusUrl: string;
  resultId?: string;
}

export interface MatchResult {
  id: string;
  resumeId: string;
  jobDescriptionId: string;
  score: number;
  scoreBreakdown: Record<string, number>;
  skillResults: Array<{ name: string; status: string; evidenceSnippet?: string }>;
  disclaimer: string;
  scoreConfigVersion: string;
  reviewStatus: string;
  reviewedOutput?: string | null;
  flags: string[];
  createdAt: string;
}

export interface SkillGapResult {
  id: string;
  categories: Array<{
    name: string;
    items: Array<{ skill: string; evidenceStatus: string; suggestedActions: string[] }>;
  }>;
  skills: Array<{ name: string; status: string; evidenceSnippet?: string }>;
  createdAt: string;
}

export interface ResumeSuggestion {
  id: string;
  resumeId: string;
  jobDescriptionId: string | null;
  originalText: string;
  proposedText: string;
  reason: string;
  sourceSnippet: string;
  sectionId: string | null;
  entryId: string | null;
  bulletId: string | null;
  field: "text" | "title" | "company" | "location" | "dates" | null;
  operation: "replace" | "add" | "remove" | null;
  sectionTitle: string | null;
  locationLabel: string | null;
  jobRequirement: string | null;
  needsUserInput: string | null;
  userInput: string | null;
  applicationStatus: "applied" | "conflict" | "needs_input" | "stale" | "not_applied";
  status: "pending" | "accepted" | "rejected";
  reviewStatus: string;
  reviewedOutput?: string | null;
  flags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InterviewQuestion {
  id: string;
  text: string;
  category: string;
  type?: "technical" | "behavioral";
  difficulty: "easy" | "medium" | "hard";
  index: number;
}

export type InterviewType = "technical" | "behavioral" | "both";

export interface InterviewSession {
  id: string;
  status: "in_progress" | "evaluating" | "completed" | "abandoned";
  currentIndex: number;
  currentQuestion: InterviewQuestion | null;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewAnswerResponse {
  status: "waiting_for_answer" | "evaluating" | "completed";
  nextQuestion: InterviewQuestion | null;
  evaluation?: InterviewEvaluation | null;
}

export interface InterviewEvaluation {
  rubricVersion: string;
  scores: Record<string, number>;
  dimensionFeedback: Array<{ dimension: string; score: number; feedback: string }>;
  overallScore: number;
  strengths: string[];
  improvements: string[];
  exampleAnswer: string | null;
  confidence: number;
  reviewStatus: string;
  reviewedOutput?: string | null;
}

export interface JobStatus {
  status: string;
  jobId?: string;
  type?: string;
  progress?: number;
  resultType?: string;
  resultId?: string;
  createdAt?: string;
  updatedAt?: string;
  error: {
    code: string;
    message: string;
  } | null;
}

interface RequestOptions extends Omit<RequestInit, "headers"> {
  token?: string;
  headers?: HeadersInit;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const { token, ...requestOptions } = options;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...requestOptions, headers });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> & ApiErrorPayload | null;
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? "The request could not be completed.",
      response.status,
      payload?.error?.code,
    );
  }
  if (!payload?.success) {
    throw new Error("The server returned an invalid response.");
  }
  return payload.data;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function registerCandidate(email: string, password: string): Promise<RegistrationResponse> {
  return request("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getConsentStatus(token: string): Promise<ConsentStatus[]> {
  return request("/api/v1/candidates/me/consents/status", { token });
}

export function recordConsent(
  token: string,
  purpose: ConsentPurpose,
  granted: boolean,
): Promise<unknown> {
  return request("/api/v1/candidates/me/consents", {
    token,
    method: "PUT",
    body: JSON.stringify({ purpose, granted }),
  });
}

export function uploadResume(token: string, file: File): Promise<ResumeUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return request("/api/v1/resumes/upload", {
    token,
    method: "POST",
    body: form,
  });
}

export function getJobStatus(token: string, jobId: string): Promise<JobStatus> {
  return request(`/api/v1/jobs/status/${encodeURIComponent(jobId)}`, { token });
}

export function getResumes(token: string): Promise<{ items: Resume[] }> {
  return request("/api/v1/resumes", { token });
}

export function getResume(token: string, resumeId: string): Promise<{ resume: Resume }> {
  return request(`/api/v1/resumes/${encodeURIComponent(resumeId)}`, { token });
}

export function getResumeDraft(
  token: string,
  resumeId: string,
  jobDescriptionId: string,
): Promise<ResumeDraftResponse> {
  const query = new URLSearchParams({ jobDescriptionId });
  return request(`/api/v1/resumes/${encodeURIComponent(resumeId)}/draft?${query}`, { token });
}

export function getResumePreview(token: string, resumeId: string): Promise<ResumeDraftResponse> {
  return request(`/api/v1/resumes/${encodeURIComponent(resumeId)}/cv/preview`, { token });
}

export async function downloadResumeCv(token: string, resumeId: string): Promise<Blob> {
  const response = await fetch(`/api/v1/resumes/${encodeURIComponent(resumeId)}/cv/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
    throw new ApiError(
      payload?.error?.message ?? "The CV download could not be completed.",
      response.status,
      payload?.error?.code,
    );
  }
  return response.blob();
}

export function updateResume(
  token: string,
  resumeId: string,
  update: { title?: string; notes?: string },
): Promise<{ resume: Resume }> {
  return request(`/api/v1/resumes/${encodeURIComponent(resumeId)}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export function submitJobDescription(
  token: string,
  input: { text?: string; file?: File },
): Promise<{ jobId: string; status: string; statusUrl: string; jobDescriptionId: string }> {
  if (input.file) {
    const form = new FormData();
    form.append("file", input.file);
    return request("/api/v1/jobs/analyze", { token, method: "POST", body: form });
  }
  return request("/api/v1/jobs/analyze", {
    token,
    method: "POST",
    body: JSON.stringify({ text: input.text }),
  });
}

export function getJobs(token: string): Promise<{ items: JobDescription[] }> {
  return request("/api/v1/jobs", { token });
}

export function getJob(token: string, jobId: string): Promise<JobDescription> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { token });
}

export function getCandidateProgress(token: string): Promise<CandidateProgress> {
  return request("/api/v1/candidates/me/progress", { token });
}

export function analyzeMatch(
  token: string,
  resumeId: string,
  jobDescriptionId: string,
): Promise<AcceptedJob> {
  return request("/api/v1/matching/analyze", {
    token,
    method: "POST",
    body: JSON.stringify({ resumeId, jobDescriptionId }),
  });
}

export function getMatch(token: string, matchId: string): Promise<MatchResult> {
  return request(`/api/v1/matches/${encodeURIComponent(matchId)}`, { token });
}

export function analyzeSkillGaps(
  token: string,
  resumeId: string,
  jobDescriptionId: string,
): Promise<AcceptedJob> {
  return request("/api/v1/skills/gaps", {
    token,
    method: "POST",
    body: JSON.stringify({ resumeId, jobDescriptionId }),
  });
}

export function getSkillGaps(token: string, gapId: string): Promise<SkillGapResult> {
  return request(`/api/v1/skills/gaps/${encodeURIComponent(gapId)}`, { token });
}

export function optimizeResume(
  token: string,
  resumeId: string,
  jobDescriptionId: string,
): Promise<AcceptedJob> {
  return request("/api/v1/resumes/optimize", {
    token,
    method: "POST",
    body: JSON.stringify({ resumeId, jobDescriptionId }),
  });
}

export function getResumeSuggestions(token: string): Promise<{ items: ResumeSuggestion[] }> {
  return request("/api/v1/suggestions", { token });
}

export function decideSuggestion(
  token: string,
  suggestionId: string,
  decision: "accept" | "reject",
  input: { proposedText?: string; userInput?: string } = {},
): Promise<ResumeSuggestion> {
  return request(`/api/v1/suggestions/${encodeURIComponent(suggestionId)}/decision`, {
    token,
    method: "POST",
    body: JSON.stringify({ decision, ...input }),
  });
}

export function generateQuestions(
  token: string,
  jobDescriptionId: string,
  resumeId: string | undefined,
  questionCount: number,
  interviewType: InterviewType = "both",
): Promise<AcceptedJob> {
  return request("/api/v1/interviews/generate", {
    token,
    method: "POST",
    body: JSON.stringify({
      jobDescriptionId,
      ...(resumeId ? { resumeId } : {}),
      questionCount,
      interviewType,
    }),
  });
}

export function getQuestionSet(
  token: string,
  questionSetId: string,
): Promise<{ id: string; questions: InterviewQuestion[] }> {
  return request(`/api/v1/interviews/question-sets/${encodeURIComponent(questionSetId)}`, { token });
}

export function startInterview(
  token: string,
  input: { jobDescriptionId?: string; questionSetId?: string },
): Promise<InterviewSession> {
  return request("/api/v1/interviews", {
    token,
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getInterview(token: string, sessionId: string): Promise<InterviewSession> {
  return request(`/api/v1/interviews/${encodeURIComponent(sessionId)}`, { token });
}

export function answerInterview(
  token: string,
  sessionId: string,
  answerText: string,
  questionIndex: number,
): Promise<InterviewAnswerResponse> {
  return request(`/api/v1/interviews/${encodeURIComponent(sessionId)}/answer`, {
    token,
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ answerText, questionIndex }),
  });
}

export function evaluateInterview(token: string, sessionId: string): Promise<AcceptedJob & { sessionId: string }> {
  return request(`/api/v1/interviews/${encodeURIComponent(sessionId)}/evaluate`, {
    token,
    method: "POST",
  });
}

export function getInterviewResults(
  token: string,
  sessionId: string,
): Promise<{ sessionId: string; status: string; evaluations: InterviewEvaluation[]; reviewStatus: string }> {
  return request(`/api/v1/interviews/${encodeURIComponent(sessionId)}/results`, { token });
}

export function getPendingReviews(token: string, query: {
  search?: string; type?: string; risk?: string; sort?: string; page?: number; pageSize?: number;
} = {}): Promise<{ items: ReviewItem[]; total: number; page: number; pageSize: number; nextPage: number | null }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return request(`/api/v1/reviews/pending?${params}`, { token });
}

export function getCoachReviewDetails(token: string, reviewId: string): Promise<CoachReviewDetails> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, { token });
}

export function decideReview(
  token: string,
  reviewId: string,
  decision: "approve" | "modify" | "reject",
  reason: string,
  options: { modifiedOutput?: string; recommendations?: string[]; internalNote?: string } = {},
): Promise<ReviewItem> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}/decision`, {
    token,
    method: "POST",
    body: JSON.stringify({ decision, reason, ...options }),
  });
}

export function claimReview(token: string, reviewId: string): Promise<ReviewItem> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}/claim`, { token, method: "POST" });
}

export function releaseReview(token: string, reviewId: string): Promise<ReviewItem> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}/release`, { token, method: "POST" });
}

export interface CoachDashboardStats {
  pending: number;
  inReviewByMe: number;
  completedToday: number;
  completedThisWeek: number;
  avgTurnaroundMinutes: number | null;
  oldestWaitingAt: string | null;
  oldestWaitingMinutes: number | null;
  byRisk: {
    high: number;
    medium: number;
    low: number;
  };
  byType: {
    job_match: number;
    resume_suggestion: number;
    interview_evaluation: number;
  };
}

export interface NextReviewItem {
  id: string;
  accountName: string;
  accountEmail: string;
  jobTitle: string | null;
  cvName: string | null;
  reviewType: "job_match" | "resume_suggestion" | "interview_evaluation";
  reviewTypeLabel: string;
  riskLevel: "low" | "medium" | "high";
  flagReason: string;
  flagReasons: string[];
  waitingTime: string;
  waitingSeconds: number;
  createdAt: string;
}

export interface DashboardQueueItem {
  id: string;
  accountName: string;
  accountEmail: string;
  jobTitle: string | null;
  cvName: string | null;
  reviewType: "job_match" | "resume_suggestion" | "interview_evaluation";
  reviewTypeLabel: string;
  riskLevel: "low" | "medium" | "high";
  flagReason: string;
  flagReasons: string[];
  waitingTime: string;
  waitingSeconds: number;
  createdAt: string;
  status: string;
  assignedCoachId: string | null;
}

export interface CoachDashboardPayload {
  stats: CoachDashboardStats;
  nextReview: NextReviewItem | null;
  queue: {
    items: DashboardQueueItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    nextPage: number | null;
  };
  pending: number;
  inReviewByMe: number;
  completedToday: number;
  completedThisWeek: number;
  avgTurnaroundMinutes: number | null;
  oldestWaitingAt: string | null;
  oldestWaitingId: string | null;
  byType: Record<string, number>;
  byRisk: Record<string, number>;
  nextInQueueId: string | null;
  recentDecisions: ReviewItem[];
}

export interface ReviewSummaryData {
  reviewId: string;
  status: string;
  account: {
    name: string;
    email: string;
    registeredDate: string;
    reviewType: "job_match" | "resume_suggestion" | "interview_evaluation";
    reviewTypeLabel: string;
    riskLevel: "low" | "medium" | "high";
    flagReason: string;
    flagReasons: string[];
    waitingTime: string;
    waitingSeconds: number;
    createdAt: string;
  };
  cv: {
    id: string | null;
    fileName: string;
    title: string | null;
    uploadDate: string | null;
    headline: string | null;
    mostRecentRole: {
      title: string;
      company: string;
    } | null;
    roleCount: number;
    topSkills: string[];
    highestEducation: {
      degree: string;
      institution: string;
    } | null;
    detectedSections: string[];
  } | null;
  job: {
    id: string | null;
    title: string;
    company: string | null;
    location: string | null;
    topSkills: string[];
    dateAdded: string | null;
  } | null;
}

export function getCoachDashboard(token: string): Promise<CoachDashboardPayload> {
  return request("/api/v1/coach/dashboard", { token });
}

export function getCoachDashboardData(
  token: string,
  options: {
    search?: string;
    type?: string;
    risk?: string;
    sort?: "oldest" | "highest_risk";
    page?: number;
    pageSize?: number;
  } = {},
): Promise<CoachDashboardPayload> {
  const params = new URLSearchParams();
  if (options.search) params.set("search", options.search);
  if (options.type) params.set("type", options.type);
  if (options.risk) params.set("risk", options.risk);
  if (options.sort) params.set("sort", options.sort);
  if (options.page) params.set("page", String(options.page));
  if (options.pageSize) params.set("pageSize", String(options.pageSize));
  const qs = params.toString();
  return request(`/api/v1/coach/dashboard${qs ? `?${qs}` : ""}`, { token });
}

export function getReviewSummary(token: string, reviewId: string): Promise<ReviewSummaryData> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}/summary`, { token });
}

export function recordReviewDrawerViewAudit(
  token: string,
  reviewId: string,
  view: "cv" | "job_description",
): Promise<{ success: boolean }> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}/audit-view`, {
    token,
    method: "POST",
    body: JSON.stringify({ view }),
  });
}

export function getCandidateFeedback(token: string): Promise<{ items: ReviewItem[] }> {
  return request("/api/v1/reviews/feedback", { token });
}

export function getCandidateFeedbackDetails(token: string, reviewId: string): Promise<CandidateCoachFeedback> {
  return request(`/api/v1/reviews/feedback/${encodeURIComponent(reviewId)}`, { token });
}

export async function getReviewResumeFile(token: string, reviewId: string): Promise<Blob> {
  const response = await fetch(`/api/v1/reviews/${encodeURIComponent(reviewId)}/resume-file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiEnvelope<unknown> & ApiErrorPayload | null;
    throw new ApiError(payload?.error?.message ?? "The original CV could not be opened.", response.status, payload?.error?.code);
  }
  return response.blob();
}

export function getNotifications(token: string, options: {
  limit?: number; cursor?: string; unreadOnly?: boolean;
} = {}): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.unreadOnly !== undefined) params.set("unreadOnly", String(options.unreadOnly));
  return request(`/api/v1/notifications?${params}`, { token });
}

export function getNotificationUnreadCount(token: string): Promise<{ count: number }> {
  return request("/api/v1/notifications/unread-count", { token });
}

export function markNotificationRead(token: string, id: string): Promise<NotificationItem> {
  return request(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { token, method: "PATCH" });
}

export function markAllNotificationsRead(token: string): Promise<{ modifiedCount: number }> {
  return request("/api/v1/notifications/read-all", { token, method: "POST" });
}

export function getAdminUsers(token: string): Promise<{ users: AdminUser[] }> {
  return request("/api/v1/admin/users", { token });
}

export function getAdminDashboard(token: string): Promise<AdminDashboard> {
  return request("/api/v1/admin/dashboard", { token });
}

export function registerCoach(
  token: string,
  input: { email: string; password: string },
): Promise<{ user: AdminUser }> {
  return request("/api/v1/admin/users", {
    token,
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminUserStatus(
  token: string,
  userId: string,
  status: "active" | "disabled",
): Promise<{ user: AdminUser }> {
  return request(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
    token,
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function getAdminAuditLogs(token: string): Promise<{ items: AdminAuditLog[] }> {
  return request("/api/v1/admin/audit-logs", { token });
}
