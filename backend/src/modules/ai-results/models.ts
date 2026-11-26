import type { ObjectId } from "mongodb";
import type { AnswerEvaluation, JobAnalysis, ResumeParse, SkillAnalysis } from "../../agents/schemas.js";
import type { SuggestionTarget } from "../resumes/structured-cv.js";

export interface ParsedResumeDataDocument extends ResumeParse {
  _id: ObjectId;
  ownerId: ObjectId;
  resumeId: ObjectId;
  parserVersion: string;
  sourceText: string;
  executionId: ObjectId;
  createdAt: Date;
}

export interface JobMatchDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  resumeId: ObjectId;
  jobDescriptionId: ObjectId;
  score: number;
  scoreBreakdown: Record<string, number>;
  skillResults: SkillAnalysis["skills"];
  disclaimer: string;
  scoreConfigVersion: string;
  agentExecutionIds: ObjectId[];
  reviewStatus: "not_required" | "pending_review" | "approved" | "edited" | "rejected";
  confidence: number;
  flags: string[];
  createdAt: Date;
}

export interface SkillGapDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  resumeId: ObjectId;
  jobDescriptionId: ObjectId;
  skills: SkillAnalysis["skills"];
  categories: SkillAnalysis["categories"];
  createdAt: Date;
}

export interface ResumeSuggestionDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  resumeId: ObjectId;
  jobDescriptionId: ObjectId | null;
  originalText: string;
  proposedText: string;
  reason: string;
  sourceSnippet: string;
  target?: SuggestionTarget | null;
  status: "pending" | "accepted" | "rejected";
  reviewStatus: "not_required" | "pending_review" | "approved" | "edited" | "rejected";
  flags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionSetDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  resumeId: ObjectId | null;
  jobDescriptionId: ObjectId | null;
  questionIds: ObjectId[];
  executionId: ObjectId;
  createdAt: Date;
}

export interface InterviewQuestionDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  questionSetId: ObjectId | null;
  prompt: string;
  competency: string;
  type?: "technical" | "behavioral";
  difficulty: "easy" | "medium" | "hard";
  createdAt: Date;
}

export interface InterviewSessionDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  questionIds: ObjectId[];
  currentIndex: number;
  answerIds: ObjectId[];
  status: "in_progress" | "evaluating" | "completed" | "abandoned";
  followUpCount: number;
  rubricVersion: string;
  evaluationId: ObjectId | null;
  reviewStatus: "not_required" | "pending_review" | "approved" | "edited" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

export interface InterviewAnswerDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  sessionId: ObjectId;
  questionId: ObjectId;
  questionIndex: number;
  answerText: string;
  idempotencyKey: string;
  createdAt: Date;
}

export interface InterviewEvaluationDocument extends AnswerEvaluation {
  _id: ObjectId;
  ownerId: ObjectId;
  sessionId: ObjectId;
  rubricVersion: string;
  overallScore: number;
  executionId: ObjectId;
  createdAt: Date;
}

export interface ReviewItemDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  targetType: "job_match" | "resume_suggestion" | "interview_evaluation" | "resume_draft";
  targetId: ObjectId;
  sourceJobDescriptionId?: ObjectId;
  targetContent?: string;
  flags: string[];
  riskLevel: "low" | "medium" | "high";
  status: "pending_review" | "in_review" | "approved" | "edited" | "rejected";
  assignedCoachId: ObjectId | null;
  requestReason: string | null;
  decisionReason: string | null;
  decisionText: string | null;
  /** Written coaching feedback sent back to the candidate after review. */
  coachFeedback: string | null;
  decidedBy: ObjectId | null;
  decidedAt: Date | null;
  videoKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateProgressDocument {
  _id: ObjectId;
  ownerId: ObjectId;
  completedInterviews: number;
  completedEvaluations: number;
  averageRubricScore: number | null;
  skillGapCount: number;
  updatedAt: Date;
}

export type PersistedJobAnalysis = JobAnalysis;
