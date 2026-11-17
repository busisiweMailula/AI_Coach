import { getDb } from "./mongo.js";
import type { UserDocument } from "../../modules/users/user.model.js";
import type { ResumeDocument } from "../../modules/resumes/resume.model.js";
import type { ConsentDocument } from "../../modules/privacy/consent.model.js";
import type { JobDescriptionDocument } from "../../modules/jobs/job-description.model.js";
import type { AsyncJobDocument } from "../jobs/job.model.js";
import type {
  CandidateProgressDocument,
  InterviewAnswerDocument,
  InterviewEvaluationDocument,
  InterviewQuestionDocument,
  InterviewSessionDocument,
  JobMatchDocument,
  ParsedResumeDataDocument,
  QuestionSetDocument,
  ResumeSuggestionDocument,
  ReviewItemDocument,
  SkillGapDocument,
} from "../../modules/ai-results/models.js";
import type { AgentExecutionDocument } from "../llm/agent-execution.model.js";

export async function ensureIndexes(): Promise<void> {
  const users = getDb().collection<UserDocument>("users");
  await users.createIndex({ email: 1 }, { unique: true, name: "users_email_unique" });
  await users.createIndex({ role: 1 }, { name: "users_role" });

  const resumes = getDb().collection<ResumeDocument>("resumes");
  await resumes.createIndex({ ownerId: 1, createdAt: -1 }, { name: "resumes_owner_created" });

  const consents = getDb().collection<ConsentDocument>("consents");
  await consents.createIndex(
    { ownerId: 1, purpose: 1, recordedAt: -1, _id: -1 },
    { name: "consents_owner_purpose_recorded" },
  );

  const jobDescriptions = getDb().collection<JobDescriptionDocument>("job_descriptions");
  await jobDescriptions.createIndex(
    { ownerId: 1, createdAt: -1 },
    { name: "job_descriptions_owner_created" },
  );

  const jobs = getDb().collection<AsyncJobDocument>("jobs");
  await jobs.createIndex({ ownerId: 1, createdAt: -1 }, { name: "jobs_owner_created" });
  await jobs.createIndex({ status: 1, createdAt: 1 }, { name: "jobs_status_created" });

  const db = getDb();
  await db.collection<AgentExecutionDocument>("agent_executions").createIndex(
    { ownerId: 1, createdAt: -1 },
    { name: "agent_executions_owner_created" },
  );
  await db.collection<ParsedResumeDataDocument>("parsed_resume_data").createIndex(
    { ownerId: 1, resumeId: 1, parserVersion: 1 },
    { unique: true, name: "parsed_resume_version_unique" },
  );
  await db.collection<JobMatchDocument>("job_matches").createIndex(
    { ownerId: 1, createdAt: -1 },
    { name: "job_matches_owner_created" },
  );
  await db.collection<SkillGapDocument>("skill_gaps").createIndex(
    { ownerId: 1, createdAt: -1 },
    { name: "skill_gaps_owner_created" },
  );
  await db.collection<ResumeSuggestionDocument>("resume_suggestions").createIndex(
    { ownerId: 1, createdAt: -1 },
    { name: "resume_suggestions_owner_created" },
  );
  await db.collection<InterviewQuestionDocument>("interview_questions").createIndex(
    { ownerId: 1, questionSetId: 1 },
    { name: "interview_questions_owner_set" },
  );
  await db.collection<QuestionSetDocument>("interview_question_sets").createIndex(
    { ownerId: 1, createdAt: -1 },
    { name: "interview_question_sets_owner_created" },
  );
  await db.collection<InterviewSessionDocument>("interview_sessions").createIndex(
    { ownerId: 1, createdAt: -1 },
    { name: "interview_sessions_owner_created" },
  );
  await db.collection<InterviewAnswerDocument>("interview_answers").createIndex(
    { ownerId: 1, sessionId: 1, idempotencyKey: 1 },
    { unique: true, name: "interview_answers_idempotency_unique" },
  );
  await db.collection<InterviewEvaluationDocument>("interview_evaluations").createIndex(
    { ownerId: 1, sessionId: 1 },
    { unique: true, name: "interview_evaluations_session_unique" },
  );
  await db.collection<ReviewItemDocument>("review_items").createIndex(
    { status: 1, createdAt: 1 },
    { name: "review_items_status_created" },
  );
  await db.collection<ReviewItemDocument>("review_items").createIndex(
    { ownerId: 1, targetType: 1, targetId: 1, status: 1 },
    { name: "review_items_owner_target_status" },
  );
  await db.collection<CandidateProgressDocument>("candidate_progress").createIndex(
    { ownerId: 1 },
    { unique: true, name: "candidate_progress_owner_unique" },
  );
}

