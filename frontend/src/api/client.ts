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
  targetType: "job_match" | "resume_suggestion" | "interview_evaluation" | "resume_draft";
  targetId: string;
  sourceJobDescriptionId: string | null;
  flags: string[];
  riskLevel: "low" | "medium" | "high";
  status: "pending_review" | "in_review" | "approved" | "edited" | "rejected";
  assignedCoachId: string | null;
  requestReason: string | null;
  decisionReason: string | null;
  decisionText: string | null;
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
    }
  | {
      type: "resume_suggestion";
      originalText: string;
      proposedText: string;
      reason: string;
      sourceSnippet: string;
    }
  | {
      type: "resume_draft";
      content: string;
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
    };

export interface CoachReviewDetails {
  review: ReviewItem;
  target: CoachReviewTarget;
}

export interface CandidateResumeDraftReview {
  review: ReviewItem;
  target: { type: "resume_draft"; content: string };
}

export interface ConsentStatus {
  purpose: string;
  policyVersion: string;
  accepted: boolean;
}

export type ConsentPurpose = "resume_processing" | "external_model_processing";

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
  status: "pending" | "accepted" | "rejected";
  reviewStatus: string;
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
): Promise<{ resumeId: string; jobDescriptionId: string; content: string; appliedSuggestionIds: string[] }> {
  const query = new URLSearchParams({ jobDescriptionId });
  return request(`/api/v1/resumes/${encodeURIComponent(resumeId)}/draft?${query}`, { token });
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
): Promise<ResumeSuggestion> {
  return request(`/api/v1/suggestions/${encodeURIComponent(suggestionId)}/decision`, {
    token,
    method: "POST",
    body: JSON.stringify({ decision }),
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

export function getPendingReviews(token: string): Promise<{ items: ReviewItem[]; nextCursor: string | null }> {
  return request("/api/v1/reviews/pending", { token });
}

export function getMyReviews(token: string): Promise<{ items: ReviewItem[] }> {
  return request("/api/v1/reviews/mine", { token });
}

export function requestResumeDraftReview(
  token: string,
  input: { resumeId: string; jobDescriptionId: string; draftContent: string; reason: string },
): Promise<ReviewItem> {
  return request("/api/v1/reviews/resume-draft", {
    token,
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCandidateResumeDraftReview(
  token: string,
  reviewId: string,
): Promise<CandidateResumeDraftReview> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, { token });
}

export function getCoachReviewDetails(token: string, reviewId: string): Promise<CoachReviewDetails> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}`, { token });
}

export function decideReview(
  token: string,
  reviewId: string,
  decision: "approve" | "edit" | "reject",
  reason: string,
  editedText?: string,
): Promise<ReviewItem> {
  return request(`/api/v1/reviews/${encodeURIComponent(reviewId)}/decision`, {
    token,
    method: "POST",
    body: JSON.stringify({ decision, reason, editedText }),
  });
}

export function getAdminUsers(token: string): Promise<{ users: AdminUser[] }> {
  return request("/api/v1/admin/users", { token });
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
