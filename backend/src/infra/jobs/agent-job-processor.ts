import { ObjectId } from "mongodb";
import { AppError, NotFoundError, ServiceUnavailableError, UpstreamServiceError, ValidationError } from "../../common/errors.js";
import {
  AnswerEvaluationSchema,
  CareerGuidanceSchema,
  JobAnalysisSchema,
  QuestionsSchema,
  ResumeParseSchema,
  ResumeSuggestionsSchema,
  SkillAnalysisSchema,
} from "../../agents/schemas.js";
import { runAgent } from "../../agents/runtime/run-agent.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { evidenceExists, normalize } from "../../guardrails/evidence.js";
import { checkFabrication } from "../../guardrails/fabrication.js";
import { findLanguageGuardrailHits, mentionsProtectedTraits } from "../../guardrails/language.js";
import { calculateMatchScore, scoreForEvidence } from "../../guardrails/scoring.js";
import { getDb } from "../db/database.js";
import { prepareResumeTextForAI } from "../../modules/privacy/resume-anonymizer.js";
import type { AsyncJobDocument } from "./job.model.js";
import type { JobDescriptionDocument } from "../../modules/jobs/job-description.model.js";
import type { ResumeDocument } from "../../modules/resumes/resume.model.js";
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
  SkillGapDocument,
} from "../../modules/ai-results/models.js";
import { createReviewItem, shouldEscalate } from "../../modules/reviews/reviews.service.js";
import { ensureExternalModelConsent } from "../../modules/privacy/privacy.service.js";
import { findRelevantResumeEvidence } from "../embeddings/resume-semantic-search.js";

const jobs = () => getDb().collection<AsyncJobDocument>("jobs");
const resumes = () => getDb().collection<ResumeDocument>("resumes");
const descriptions = () => getDb().collection<JobDescriptionDocument>("job_descriptions");

export async function processAgentJob(id: ObjectId): Promise<void> {
  const now = new Date();
  const claimed = await jobs().findOneAndUpdate(
    { _id: id, status: "queued" },
    { $set: { status: "running", updatedAt: now }, $inc: { attempt: 1 } },
    { returnDocument: "after" },
  );
  if (!claimed) return;

  try {
    const result = await dispatch(claimed);
    await jobs().updateOne(
      { _id: id, status: "running" },
      { $set: { status: "succeeded", progress: 100, resultType: result.type, resultId: result.id, updatedAt: new Date() } },
    );
  } catch (error) {
    const safeErrorCode = error instanceof AppError ? error.code
      : error instanceof Error && error.message === "FABRICATION_GUARDRAIL_HIT"
        ? "FABRICATION_GUARDRAIL_HIT"
        : "AGENT_EXECUTION_FAILED";
    await jobs().updateOne(
      { _id: id, status: "running" },
      { $set: { status: "failed", safeErrorCode, updatedAt: new Date() } },
    );
    await setLinkedFailure(claimed, safeErrorCode);
    logger.error(
      { err: error, jobId: id.toHexString(), jobType: claimed.type, safeErrorCode },
      "Agent job failed",
    );
  }
}

async function dispatch(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  if (job.type === "jd_analysis") return analyzeJobDescription(job);
  if (job.type === "resume_parse") return parseResume(job);
  if (job.type === "matching" || job.type === "skill_gaps") return analyzeMatch(job);
  if (job.type === "resume_optimize") return createSuggestions(job);
  if (job.type === "question_generation") return generateQuestions(job);
  if (job.type === "career_guidance") return generateCareerGuidance(job);
  if (job.type === "interview_evaluation") return evaluateInterview(job);
  throw new ServiceUnavailableError("No handler is registered for this job type");
}

async function analyzeJobDescription(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  const descriptionId = requiredObjectId(job.resultId, "Job description reference is missing");
  const description = await descriptions().findOne({ _id: descriptionId, ownerId: job.ownerId });
  if (!description) throw new NotFoundError("Job description not found");
  const run = await runAgent({
    ownerId: job.ownerId,
    task: "jd_analyzer",
    promptVersion: "jd-analyzer-v1",
    input: { jobDescriptionText: description.normalizedText },
    schema: JobAnalysisSchema,
  });
  for (const item of [...run.value.requiredSkills, ...run.value.preferredSkills]) {
    if (!evidenceExists(description.normalizedText, item.evidenceSnippet)) {
      throw new UpstreamServiceError("Job analysis returned evidence not found in the source text");
    }
  }
  for (const item of run.value.responsibilities) {
    if (!evidenceExists(description.normalizedText, item.evidenceSnippet)) {
      throw new UpstreamServiceError("Job analysis returned evidence not found in the source text");
    }
  }
  await descriptions().updateOne(
    { _id: description._id, ownerId: job.ownerId },
    {
      $set: {
        ...run.value,
        analysisStatus: "succeeded",
        analyzerVersion: "jd-analyzer-v1",
        agentExecutionIds: [run.executionId],
        updatedAt: new Date(),
      },
    },
  );
  return { type: "job_description", id: description._id };
}

async function parseResume(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  const resumeId = requiredObjectId(job.resultId, "Resume reference is missing");
  const resume = await resumes().findOne({ _id: resumeId, ownerId: job.ownerId });
  if (!resume) throw new NotFoundError("Resume not found");
  const anonymizedResumeText = await prepareResumeTextForAI(
    job.ownerId.toHexString(),
    resume.extractedText,
  );
  const run = await runAgent({
    ownerId: job.ownerId,
    task: "resume_parser",
    promptVersion: "resume-parser-v1",
    input: { resumeText: anonymizedResumeText },
    schema: ResumeParseSchema,
    requiresResumeProcessingConsent: true,
  });
  const validSkills = run.value.skills.filter((item) => evidenceExists(anonymizedResumeText, item.evidenceSnippet));
  const validWorkHistory = run.value.workHistory.filter((item) => evidenceExists(anonymizedResumeText, item.evidenceSnippet));
  const validEducation = run.value.education.filter((item) => evidenceExists(anonymizedResumeText, item.evidenceSnippet));
  const flags = [...run.value.uncertaintyFlags];
  if (validSkills.length !== run.value.skills.length ||
      validWorkHistory.length !== run.value.workHistory.length ||
      validEducation.length !== run.value.education.length) {
    flags.push("evidence_not_found_in_source");
  }

  const parsedId = new ObjectId();
  const parsed: ParsedResumeDataDocument = {
    _id: parsedId,
    ownerId: job.ownerId,
    resumeId,
    parserVersion: "resume-parser-v1",
    sourceText: resume.extractedText,
    summary: run.value.summary,
    skills: validSkills,
    workHistory: validWorkHistory,
    education: validEducation,
    uncertaintyFlags: flags,
    executionId: run.executionId,
    createdAt: new Date(),
  };
  await getDb().collection<ParsedResumeDataDocument>("parsed_resume_data").insertOne(parsed);
  await resumes().updateOne(
    { _id: resumeId, ownerId: job.ownerId },
    { $set: { parseStatus: "parsed", parsedResumeDataId: parsedId, parserVersion: "resume-parser-v1", updatedAt: new Date() } },
  );
  return { type: "parsed_resume_data", id: parsedId };
}

async function analyzeMatch(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  const resumeId = requiredObjectId(job.payload?.resumeId, "Resume reference is missing");
  const jobDescriptionId = requiredObjectId(job.payload?.jobDescriptionId, "Job description reference is missing");
  const [resume, description] = await Promise.all([
    resumes().findOne({ _id: resumeId, ownerId: job.ownerId }),
    descriptions().findOne({ _id: jobDescriptionId, ownerId: job.ownerId }),
  ]);
  if (!resume || !description) throw new NotFoundError("Resume or job description not found");
  const anonymizedResumeText = await prepareResumeTextForAI(
    job.ownerId.toHexString(),
    resume.extractedText,
  );
  if (env.EMBEDDING_PROVIDER === "mistral") {
    await ensureExternalModelConsent(job.ownerId);
  }
  const relevantResumeEvidence = env.EMBEDDING_PROVIDER === "mistral"
    ? await findRelevantResumeEvidence({
        ownerId: job.ownerId,
        resumeId,
        anonymizedResumeText,
        queryText: buildMatchQuery(description),
      })
    : [];
  const requestedSkills = [
    ...(description.requiredSkills ?? []),
    ...(description.preferredSkills ?? []),
  ];
  const run = await runAgent({
    ownerId: job.ownerId,
    task: "skill_gap_analyzer",
    promptVersion: "skill-gap-analyzer-v1",
    input: {
      resumeText: anonymizedResumeText,
      relevantResumeEvidence,
      requiredSkills: description.requiredSkills ?? [],
      preferredSkills: description.preferredSkills ?? [],
    },
    schema: SkillAnalysisSchema,
    requiresResumeProcessingConsent: true,
  });

  const flags: string[] = [];
  const results = requestedSkills.map((skill) => {
    const classified = run.value.skills.find((item) => normalize(item.name) === normalize(skill.name));
    if (!classified || classified.status === "no_evidence_found") {
      return { name: skill.name, status: "no_evidence_found" as const };
    }
    if (!classified.evidenceSnippet || !evidenceExists(anonymizedResumeText, classified.evidenceSnippet)) {
      flags.push("evidence_not_found_in_source");
      return { name: skill.name, status: "no_evidence_found" as const };
    }
    return {
      name: skill.name,
      status: classified.status,
      evidenceSnippet: classified.evidenceSnippet,
    };
  });
  if (mentionsProtectedTraits(JSON.stringify(run.value))) {
    flags.push("possible_protected_trait_reference");
  }
  const gap = results.filter((item) => item.status !== "matched");
  const gapId = new ObjectId();
  const gapDoc: SkillGapDocument = {
    _id: gapId,
    ownerId: job.ownerId,
    resumeId,
    jobDescriptionId,
    skills: results,
    categories: gap.length
      ? [{
          category: "no_evidence_found",
          skills: gap.map((item) => item.name),
          actions: ["Consider adding relevant, truthful evidence where it reflects your experience."],
        }]
      : [],
    createdAt: new Date(),
  };
  await getDb().collection<SkillGapDocument>("skill_gaps").insertOne(gapDoc);
  if (job.type === "skill_gaps") return { type: "skill_gap", id: gapId };

  const requiredNames = new Set((description.requiredSkills ?? []).map((item) => normalize(item.name)));
  const resultValues = new Map(results.map((item) => [normalize(item.name), scoreForEvidence(item.status)]));
  const requiredValues = [...requiredNames].map((name) => resultValues.get(name) ?? 0);
  const preferredValues = (description.preferredSkills ?? []).map((item) => resultValues.get(normalize(item.name)) ?? 0);
  const responsibilityValues = (description.responsibilities ?? []).map((item) => (
    evidenceExists(anonymizedResumeText, item.evidenceSnippet) ? 1 : 0
  ));
  const quality = results.length
    ? results.filter((item) => item.status !== "no_evidence_found" && item.evidenceSnippet).length / results.length
    : null;
  const score = await calculateMatchScore({
    requiredSkillValues: requiredValues,
    preferredSkillValues: preferredValues,
    responsibilityValues,
    experienceAlignment: null,
    evidenceQuality: quality,
  });
  const matchId = job.resultId ?? new ObjectId();
  const escalation = await shouldEscalate(run.value.confidence, flags);
  const match: JobMatchDocument = {
    _id: matchId,
    ownerId: job.ownerId,
    resumeId,
    jobDescriptionId,
    score: score.score,
    scoreBreakdown: score.breakdown,
    skillResults: results,
    disclaimer: "Indicative preparation feedback only; not a hiring decision.",
    scoreConfigVersion: score.configVersion,
    agentExecutionIds: [run.executionId],
    reviewStatus: escalation.required ? "pending_review" : "not_required",
    confidence: run.value.confidence,
    flags: escalation.flags,
    createdAt: new Date(),
  };
  await getDb().collection<JobMatchDocument>("job_matches").insertOne(match);
  if (escalation.required) {
    await createReviewItem({
      ownerId: job.ownerId,
      targetType: "job_match",
      targetId: matchId,
      flags: escalation.flags,
      riskLevel: escalation.riskLevel,
    });
  }
  return { type: "job_match", id: matchId };
}

function buildMatchQuery(description: JobDescriptionDocument): string {
  const requirements = [
    description.roleTitle,
    ...(description.requiredSkills ?? []).map((item) => `${item.name}: ${item.evidenceSnippet}`),
    ...(description.preferredSkills ?? []).map((item) => `${item.name}: ${item.evidenceSnippet}`),
    ...(description.responsibilities ?? []).map((item) => `${item.text}: ${item.evidenceSnippet}`),
  ].filter((item): item is string => Boolean(item?.trim()));
  return requirements.join("\n") || description.normalizedText;
}

async function createSuggestions(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  const resumeId = requiredObjectId(job.payload?.resumeId, "Resume reference is missing");
  const jobDescriptionId = job.payload?.jobDescriptionId
    ? requiredObjectId(job.payload.jobDescriptionId, "Job description reference is invalid")
    : null;
  const [resume, description] = await Promise.all([
    resumes().findOne({ _id: resumeId, ownerId: job.ownerId }),
    jobDescriptionId
      ? descriptions().findOne({ _id: jobDescriptionId, ownerId: job.ownerId })
      : Promise.resolve(null),
  ]);
  if (!resume || (jobDescriptionId && !description)) throw new NotFoundError("Resume or job description not found");
  const anonymizedResumeText = await prepareResumeTextForAI(
    job.ownerId.toHexString(),
    resume.extractedText,
  );
  const run = await runAgent({
    ownerId: job.ownerId,
    task: "resume_coach",
    promptVersion: "resume-coach-v1",
    input: { resumeText: anonymizedResumeText, jobDescriptionText: description?.normalizedText ?? null },
    schema: ResumeSuggestionsSchema,
    requiresResumeProcessingConsent: true,
  });
  const savedIds: ObjectId[] = [];
  for (const item of run.value.suggestions) {
    const supported = evidenceExists(anonymizedResumeText, item.sourceSnippet) &&
      evidenceExists(anonymizedResumeText, item.originalText);
    const factual = checkFabrication(item.proposedText, anonymizedResumeText);
    if (!supported || !factual.safe || findLanguageGuardrailHits(item.proposedText).length > 0) continue;
    const suggestionId = new ObjectId();
    const suggestion: ResumeSuggestionDocument = {
      _id: suggestionId,
      ownerId: job.ownerId,
      resumeId,
      jobDescriptionId,
      ...item,
      status: "pending",
      reviewStatus: "not_required",
      flags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await getDb().collection<ResumeSuggestionDocument>("resume_suggestions").insertOne(suggestion);
    savedIds.push(suggestionId);
  }
  if (savedIds.length === 0 && run.value.suggestions.length > 0) {
    throw new Error("FABRICATION_GUARDRAIL_HIT");
  }
  return { type: "resume_suggestion", id: savedIds[0] ?? new ObjectId() };
}

async function generateQuestions(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  const resumeId = job.payload?.resumeId
    ? requiredObjectId(job.payload.resumeId, "Resume reference is invalid")
    : null;
  const jobDescriptionId = job.payload?.jobDescriptionId
    ? requiredObjectId(job.payload.jobDescriptionId, "Job description reference is invalid")
    : null;
  const [resume, description] = await Promise.all([
    resumeId ? resumes().findOne({ _id: resumeId, ownerId: job.ownerId }) : Promise.resolve(null),
    jobDescriptionId
      ? descriptions().findOne({ _id: jobDescriptionId, ownerId: job.ownerId })
      : Promise.resolve(null),
  ]);
  if ((resumeId && !resume) || !description) throw new NotFoundError("Resume or job description not found");
  const anonymizedResumeText = resume
    ? await prepareResumeTextForAI(job.ownerId.toHexString(), resume.extractedText)
    : null;
  const run = await runAgent({
    ownerId: job.ownerId,
    task: "question_generator",
    promptVersion: "question-generator-v1",
    input: { resumeText: anonymizedResumeText, jobDescriptionText: description.normalizedText },
    schema: QuestionsSchema,
    requiresResumeProcessingConsent: Boolean(resumeId),
  });
  const setId = new ObjectId();
  const questionIds: ObjectId[] = [];
  const requestedCount = Number(job.payload?.questionCount ?? "8");
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 20) {
    throw new ValidationError("Question count is invalid");
  }
  for (const question of run.value.questions.slice(0, requestedCount)) {
    const questionId = new ObjectId();
    const document: InterviewQuestionDocument = {
      _id: questionId,
      ownerId: job.ownerId,
      questionSetId: setId,
      ...question,
      createdAt: new Date(),
    };
    await getDb().collection<InterviewQuestionDocument>("interview_questions").insertOne(document);
    questionIds.push(questionId);
  }
  const questionSet: QuestionSetDocument = {
    _id: setId,
    ownerId: job.ownerId,
    resumeId,
    jobDescriptionId,
    questionIds,
    executionId: run.executionId,
    createdAt: new Date(),
  };
  await getDb().collection<QuestionSetDocument>("interview_question_sets").insertOne(questionSet);
  return { type: "question_set", id: setId };
}

async function generateCareerGuidance(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  const gapId = requiredObjectId(job.payload?.skillGapId, "Skill gap reference is missing");
  const gaps = await getDb().collection<SkillGapDocument>("skill_gaps").findOne({
    _id: gapId,
    ownerId: job.ownerId,
  });
  if (!gaps) throw new NotFoundError("Skill gap result not found");
  const run = await runAgent({
    ownerId: job.ownerId,
    task: "career_guidance",
    promptVersion: "career-guidance-v1",
    input: { skillGaps: gaps.categories },
    schema: CareerGuidanceSchema,
  });
  const id = job.resultId ?? new ObjectId();
  await getDb().collection("career_guidance").insertOne({
    _id: id,
    ownerId: job.ownerId,
    skillGapId: gapId,
    recommendations: run.value.recommendations,
    executionId: run.executionId,
    createdAt: new Date(),
  });
  return { type: "career_guidance", id };
}

async function evaluateInterview(job: AsyncJobDocument): Promise<{ type: string; id: ObjectId }> {
  const sessionId = requiredObjectId(job.payload?.sessionId, "Interview session reference is missing");
  const session = await getDb().collection<InterviewSessionDocument>("interview_sessions").findOne({
    _id: sessionId,
    ownerId: job.ownerId,
  });
  if (!session) throw new NotFoundError("Interview session not found");
  const answers = await getDb().collection<InterviewAnswerDocument>("interview_answers")
    .find({ ownerId: job.ownerId, sessionId })
    .sort({ questionIndex: 1 })
    .toArray();
  if (answers.length === 0) throw new ValidationError("An interview needs at least one answer before evaluation");
  const questions = await getDb().collection<InterviewQuestionDocument>("interview_questions")
    .find({ _id: { $in: answers.map((answer) => answer.questionId) }, ownerId: job.ownerId })
    .toArray();
  const questionById = new Map(questions.map((question) => [question._id.toHexString(), question]));
  const run = await runAgent({
    ownerId: job.ownerId,
    task: "answer_evaluator",
    promptVersion: "answer-evaluator-v1",
    input: {
      questionAnswers: answers.map((answer) => ({
        question: questionById.get(answer.questionId.toHexString())?.prompt ?? "",
        answer: answer.answerText,
      })),
    },
    schema: AnswerEvaluationSchema,
  });
  const evaluationId = new ObjectId();
  const rubric = JSON.parse(await readRubric()) as {
    version: string;
    dimensions: Array<{ id: string; weight: number }>;
  };
  const dimensionScores = new Map(run.value.dimensions.map((item) => [item.dimension, item.score]));
  const overallScore = rubric.dimensions.reduce(
    (score, dimension) => score + (dimensionScores.get(dimension.id as typeof run.value.dimensions[number]["dimension"]) ?? 0) * dimension.weight,
    0,
  );
  const evaluation: InterviewEvaluationDocument = {
    _id: evaluationId,
    ownerId: job.ownerId,
    sessionId,
    ...run.value,
    rubricVersion: rubric.version,
    overallScore,
    executionId: run.executionId,
    createdAt: new Date(),
  };
  await getDb().collection<InterviewEvaluationDocument>("interview_evaluations").insertOne(evaluation);
  const escalation = await shouldEscalate(
    run.value.confidence,
    findLanguageGuardrailHits(JSON.stringify(run.value)),
  );
  const reviewStatus = escalation.required ? "pending_review" : "not_required";
  await getDb().collection<InterviewSessionDocument>("interview_sessions").updateOne(
    { _id: sessionId, ownerId: job.ownerId },
    { $set: { status: "completed", evaluationId, reviewStatus, updatedAt: new Date() } },
  );
  if (escalation.required) {
    await createReviewItem({
      ownerId: job.ownerId,
      targetType: "interview_evaluation",
      targetId: evaluationId,
      flags: escalation.flags,
      riskLevel: escalation.riskLevel,
    });
  }
  await updateCandidateProgress(job.ownerId);
  return { type: "interview_evaluation", id: evaluationId };
}

async function updateCandidateProgress(ownerId: ObjectId): Promise<void> {
  const db = getDb();
  const [completedInterviews, evaluations, gapCount] = await Promise.all([
    db.collection<InterviewSessionDocument>("interview_sessions").countDocuments({ ownerId, status: "completed" }),
    db.collection<InterviewEvaluationDocument>("interview_evaluations").find({ ownerId }).toArray(),
    db.collection<SkillGapDocument>("skill_gaps").countDocuments({ ownerId }),
  ]);
  const averageRubricScore = evaluations.length
    ? evaluations.reduce((sum, item) => sum + item.overallScore, 0) / evaluations.length
    : null;
  const progress: CandidateProgressDocument = {
    _id: ownerId,
    ownerId,
    completedInterviews,
    completedEvaluations: evaluations.length,
    averageRubricScore,
    skillGapCount: gapCount,
    updatedAt: new Date(),
  };
  await db.collection<CandidateProgressDocument>("candidate_progress").replaceOne(
    { _id: ownerId },
    progress,
    { upsert: true },
  );
}

async function setLinkedFailure(job: AsyncJobDocument, code: string): Promise<void> {
  if (job.type === "jd_analysis" && job.resultId) {
    await descriptions().updateOne(
      { _id: job.resultId, ownerId: job.ownerId },
      { $set: { analysisStatus: "failed", updatedAt: new Date() } },
    );
  }
  if (job.type === "resume_parse" && job.resultId) {
    await resumes().updateOne(
      { _id: job.resultId, ownerId: job.ownerId },
      { $set: { parseStatus: "failed", updatedAt: new Date() } },
    );
  }
  if (job.type === "interview_evaluation" && job.payload?.sessionId) {
    await getDb().collection<InterviewSessionDocument>("interview_sessions").updateOne(
      { _id: new ObjectId(job.payload.sessionId), ownerId: job.ownerId, status: "evaluating" },
      { $set: { status: "in_progress", updatedAt: new Date() } },
    );
  }
  logger.warn({ jobId: job._id.toHexString(), code }, "Linked workflow status updated after job failure");
}

function requiredObjectId(value: ObjectId | string | null | undefined, message: string): ObjectId {
  if (value instanceof ObjectId) return value;
  if (typeof value !== "string" || !ObjectId.isValid(value)) throw new ValidationError(message);
  return new ObjectId(value);
}

async function readRubric(): Promise<string> {
  return (await import("node:fs/promises")).readFile(
    new URL("../../../config/rubric.v1.json", import.meta.url),
    "utf8",
  );
}
