import { ObjectId } from "mongodb";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors.js";
import { getLlmProvider } from "../../infra/llm/provider-factory.js";
import { enqueueAgentJob } from "../../infra/jobs/job-queue.js";
import { getDb } from "../../infra/db/database.js";
import { ensureResumeConsent } from "../privacy/privacy.service.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { recordAuditEvent } from "../users/audit-log.service.js";
import { deriveStructuredCv, isCvReadyText } from "../resumes/resume-suggestions.js";
import { createResumeWordDocument } from "../resumes/cv-word-export.js";
import { ensureResumeStructuredCv } from "../resumes/resumes.service.js";
import type {
  CandidateProgressDocument,
  JobMatchDocument,
  InterviewQuestionDocument,
  QuestionSetDocument,
  ResumeSuggestionDocument,
  SkillGapDocument,
} from "../ai-results/models.js";
import type { ResumeDocument } from "../resumes/resume.model.js";
import type { JobDescriptionDocument } from "../jobs/job-description.model.js";

const idsSchema = z.object({
  resumeId: z.string().regex(/^[\da-f]{24}$/i),
  jobDescriptionId: z.string().regex(/^[\da-f]{24}$/i),
}).strict();

const optimizeSchema = idsSchema;
const questionSchema = z.object({
  jobDescriptionId: z.string().regex(/^[\da-f]{24}$/i),
  resumeId: z.string().regex(/^[\da-f]{24}$/i).optional(),
  questionCount: z.number().int().min(1).max(20).default(8),
  interviewType: z.enum(["technical", "behavioral", "both"]).default("both"),
}).strict().superRefine((request, context) => {
  if (request.interviewType === "both" && request.questionCount < 2) {
    context.addIssue({
      code: "custom",
      path: ["questionCount"],
      message: "At least two questions are required for both interview types",
    });
  }
});

const guidanceSchema = z.object({ skillGapId: z.string().regex(/^[\da-f]{24}$/i) }).strict();
const decisionSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  proposedText: z.string().max(2000).optional(),
  userInput: z.string().trim().max(1000).optional(),
}).strict();

export const workflowsRouter = Router();
const candidateOnly = [authMiddleware, requireRole("candidate")] as const;

workflowsRouter.get(
  "/candidates/me/progress",
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const ownerId = new ObjectId(req.auth.userId);
    const progress = await getDb().collection<CandidateProgressDocument>("candidate_progress").findOne({
      _id: ownerId,
      ownerId,
    });
    res.status(200).json({
      success: true,
      data: {
        completedInterviews: progress?.completedInterviews ?? 0,
        completedEvaluations: progress?.completedEvaluations ?? 0,
        averageRubricScores: progress ? { overall: progress.averageRubricScore } : {},
        skillGapCount: progress?.skillGapCount ?? 0,
        updatedAt: (progress?.updatedAt ?? new Date(0)).toISOString(),
      },
    });
  }),
);

workflowsRouter.post(
  "/matching/analyze",
  ...candidateOnly,
  validateBody(idsSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    getLlmProvider();
    const [resume, description] = await loadOwnedInputs(req.auth.userId, req.body.resumeId, req.body.jobDescriptionId);
    if (!resume || !description) throw new NotFoundError("Resume or job description not found");
    const job = await enqueueAgentJob({
      ownerId: req.auth.userId,
      type: "matching",
      resultType: "job_match",
      payload: req.body,
    });
    res.status(202).json({ success: true, data: acceptedJob(job._id, job.resultId) });
  }),
);

workflowsRouter.get(
  "/matches/:matchId",
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const match = await getDb().collection<JobMatchDocument>("job_matches").findOne({
      _id: parseId(req.params.matchId),
      ownerId: new ObjectId(req.auth.userId),
    });
    if (!match) throw new NotFoundError("Match result not found");
    res.status(200).json({ success: true, data: matchResponse(match) });
  }),
);

workflowsRouter.post(
  "/skills/gaps",
  ...candidateOnly,
  validateBody(idsSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    getLlmProvider();
    const [resume, description] = await loadOwnedInputs(req.auth.userId, req.body.resumeId, req.body.jobDescriptionId);
    if (!resume || !description) throw new NotFoundError("Resume or job description not found");
    const job = await enqueueAgentJob({
      ownerId: req.auth.userId,
      type: "skill_gaps",
      resultType: "skill_gap",
      payload: req.body,
    });
    res.status(202).json({ success: true, data: acceptedJob(job._id, job.resultId) });
  }),
);

workflowsRouter.get(
  "/skills/gaps/:gapId",
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const gap = await getDb().collection<SkillGapDocument>("skill_gaps").findOne({
      _id: parseId(req.params.gapId),
      ownerId: new ObjectId(req.auth.userId),
    });
    if (!gap) throw new NotFoundError("Skill gap result not found");
    res.status(200).json({ success: true, data: gapResponse(gap) });
  }),
);

workflowsRouter.post(
  "/resumes/optimize",
  ...candidateOnly,
  validateBody(optimizeSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    getLlmProvider();
    const [resume, description] = await loadOwnedInputs(req.auth.userId, req.body.resumeId, req.body.jobDescriptionId);
    if (!resume || !description) throw new NotFoundError("Resume or job description not found");
    const job = await enqueueAgentJob({
      ownerId: req.auth.userId,
      type: "resume_optimize",
      resultType: "resume_suggestion",
      payload: req.body,
    });
    res.status(202).json({ success: true, data: acceptedJob(job._id, job.resultId) });
  }),
);

workflowsRouter.get(
  ["/resumes/:resumeId/cv/preview", "/resumes/:resumeId/draft"],
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const query = z.object({
      jobDescriptionId: z.string().regex(/^[\da-f]{24}$/i).optional(),
    }).strict().safeParse(req.query);
    if (!query.success) throw new ValidationError("Request validation failed", query.error.flatten());
    const ownerId = new ObjectId(req.auth.userId);
    await ensureResumeConsent(req.auth.userId);
    const resume = await getDb().collection<ResumeDocument>("resumes").findOne({
      _id: parseId(req.params.resumeId),
      ownerId,
    });
    if (!resume) throw new NotFoundError("Resume not found");
    const baseCv = await ensureResumeStructuredCv(resume);
    const allSuggestions = await getDb().collection<ResumeSuggestionDocument>("resume_suggestions")
      .find({ ownerId, resumeId: resume._id })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const derived = deriveStructuredCv(baseCv, allSuggestions);
    const user = await getDb().collection<{ _id: ObjectId; email: string }>("users")
      .findOne({ _id: ownerId }, { projection: { email: 1 } });
    const structuredCv = user?.email
      ? { ...derived.structuredCv, header: { ...derived.structuredCv.header, email: user.email } }
      : derived.structuredCv;
    res.status(200).json({
      success: true,
      data: {
        resumeId: resume._id.toHexString(),
        jobDescriptionId: query.data.jobDescriptionId ?? null,
        structuredCv,
        suggestions: allSuggestions.map((item) =>
          suggestionResponse(item, derived.applicationStates.get(item._id.toHexString()))),
        acceptedSuggestions: allSuggestions
          .filter((item) => item.status === "accepted")
          .map((item) => ({
            id: item._id.toHexString(),
            originalText: item.originalText,
            proposedText: item.proposedText,
            target: null,
            locationLabel: item.locationLabel ?? item.sectionTitle ?? "CV section",
            applicationStatus: derived.applicationStates.get(item._id.toHexString()) ?? "not_applied",
          })),
      },
    });
  }),
);

workflowsRouter.get(
  "/resumes/:resumeId/cv/download",
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const query = z.object({
      jobDescriptionId: z.string().regex(/^[\da-f]{24}$/i).optional(),
    }).strict().safeParse(req.query);
    if (!query.success) throw new ValidationError("Request validation failed", query.error.flatten());
    const ownerId = new ObjectId(req.auth.userId);
    await ensureResumeConsent(req.auth.userId);
    const resume = await getDb().collection<ResumeDocument>("resumes").findOne({
      _id: parseId(req.params.resumeId),
      ownerId,
    });
    if (!resume) throw new NotFoundError("Resume not found");
    if (query.data.jobDescriptionId) {
      const description = await getDb().collection<JobDescriptionDocument>("job_descriptions").findOne({
        _id: parseId(query.data.jobDescriptionId),
        ownerId,
      });
      if (!description) throw new NotFoundError("Job description not found");
    }
    const baseCv = await ensureResumeStructuredCv(resume);
    const suggestions = await getDb().collection<ResumeSuggestionDocument>("resume_suggestions")
      .find({ ownerId, resumeId: resume._id })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const derivedCv = deriveStructuredCv(baseCv, suggestions).structuredCv;
    const user = await getDb().collection<{ _id: ObjectId; email: string }>("users")
      .findOne({ _id: ownerId }, { projection: { email: 1 } });
    if (user?.email) derivedCv.header.email = user.email;
    const document = await createResumeWordDocument(derivedCv);
    const fileName = `${safeDownloadName(resume.title || resume.originalFileName)}-updated.docx`;
    await recordAuditEvent({
      actorId: ownerId,
      ownerId,
      targetId: resume._id,
      targetType: "resume_cv",
      action: "GET /api/v1/resumes/:id/cv/download",
      requestId: res.locals.requestId,
    });
    res.status(200)
      .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
      .send(document);
  }),
);

workflowsRouter.get(
  "/suggestions",
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const items = await getDb().collection<ResumeSuggestionDocument>("resume_suggestions")
      .find({ ownerId: new ObjectId(req.auth.userId) })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    res.status(200).json({
      success: true,
      data: { items: items.map((item) => suggestionResponse(item)), nextCursor: null },
    });
  }),
);

workflowsRouter.post(
  "/suggestions/:suggestionId/decision",
  ...candidateOnly,
  validateBody(decisionSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const id = parseId(req.params.suggestionId);
    const ownerId = new ObjectId(req.auth.userId);
    const existing = await getDb().collection<ResumeSuggestionDocument>("resume_suggestions").findOne({
      _id: id,
      ownerId,
    });
    if (!existing) throw new NotFoundError("Resume suggestion not found");
    const editedProposal = req.body.proposedText !== undefined &&
      req.body.proposedText !== existing.proposedText;
    if (req.body.decision === "accept" &&
      existing.needsUserInput &&
      !req.body.userInput?.trim() &&
      !editedProposal) {
      throw new ValidationError("Supply the requested information or edit the proposal before accepting");
    }
    if (req.body.decision === "accept" && existing.operation !== "remove" &&
      !isCvReadyText(req.body.proposedText ?? existing.proposedText)) {
      throw new ValidationError("The proposed text must be final CV-ready text");
    }
    const set: Record<string, unknown> = {
      status: req.body.decision === "accept" ? "accepted" : "rejected",
      updatedAt: new Date(),
    };
    if (req.body.proposedText !== undefined) set.proposedText = req.body.proposedText;
    if (req.body.userInput !== undefined) set.userInput = req.body.userInput;
    const update: Record<string, unknown> = { $set: set };
    if (editedProposal) update.$unset = { needsUserInput: "", flags: "" };
    const result = await getDb().collection<ResumeSuggestionDocument>("resume_suggestions").findOneAndUpdate(
      { _id: id, ownerId },
      update,
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError("Resume suggestion not found");
    const resume = await getDb().collection<ResumeDocument>("resumes").findOne({
      _id: result.resumeId,
      ownerId,
    });
    if (!resume) throw new NotFoundError("Resume not found");
    const cv = await ensureResumeStructuredCv(resume);
    const suggestions = await getDb().collection<ResumeSuggestionDocument>("resume_suggestions")
      .find({ ownerId, resumeId: result.resumeId })
      .toArray();
    const states = deriveStructuredCv(cv, suggestions).applicationStates;
    res.status(200).json({
      success: true,
      data: suggestionResponse(result, states.get(result._id.toHexString())),
    });
  }),
);

workflowsRouter.post(
  "/interviews/generate",
  ...candidateOnly,
  validateBody(questionSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    getLlmProvider();
    const ownerId = new ObjectId(req.auth.userId);
    const description = await getDb().collection<JobDescriptionDocument>("job_descriptions").findOne({
      _id: parseId(req.body.jobDescriptionId),
      ownerId,
    });
    const resume = req.body.resumeId
      ? await getDb().collection<ResumeDocument>("resumes").findOne({ _id: parseId(req.body.resumeId), ownerId })
      : null;
    if (!description || (req.body.resumeId && !resume)) throw new NotFoundError("Resume or job description not found");
    const job = await enqueueAgentJob({
      ownerId,
      type: "question_generation",
      resultType: "question_set",
      payload: {
        jobDescriptionId: req.body.jobDescriptionId,
        ...(req.body.resumeId ? { resumeId: req.body.resumeId } : {}),
        questionCount: String(req.body.questionCount),
        interviewType: req.body.interviewType,
      },
    });
    res.status(202).json({ success: true, data: acceptedJob(job._id, job.resultId) });
  }),
);

workflowsRouter.get(
  "/interviews/question-sets/:questionSetId",
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const ownerId = new ObjectId(req.auth.userId);
    const questionSet = await getDb().collection<QuestionSetDocument>("interview_question_sets").findOne({
      _id: parseId(req.params.questionSetId),
      ownerId,
    });
    if (!questionSet) throw new NotFoundError("Question set not found");
    const questions = await getDb().collection<InterviewQuestionDocument>("interview_questions")
      .find({ _id: { $in: questionSet.questionIds }, ownerId }).toArray();
    const byId = new Map(questions.map((question) => [question._id.toHexString(), question]));
    res.status(200).json({
      success: true,
      data: {
        id: questionSet._id.toHexString(),
        questions: questionSet.questionIds.flatMap((id, index) => {
          const question = byId.get(id.toHexString());
          return question ? [questionResponse(question, index)] : [];
        }),
      },
    });
  }),
);

workflowsRouter.post(
  "/career/guidance",
  ...candidateOnly,
  validateBody(guidanceSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    getLlmProvider();
    const gap = await getDb().collection<SkillGapDocument>("skill_gaps").findOne({
      _id: parseId(req.body.skillGapId),
      ownerId: new ObjectId(req.auth.userId),
    });
    if (!gap) throw new NotFoundError("Skill gap result not found");
    const job = await enqueueAgentJob({
      ownerId: req.auth.userId,
      type: "career_guidance",
      resultType: "career_guidance",
      payload: req.body,
    });
    res.status(202).json({ success: true, data: acceptedJob(job._id, job.resultId) });
  }),
);

workflowsRouter.get(
  "/career/guidance/:guidanceId",
  ...candidateOnly,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const result = await getDb().collection("career_guidance").findOne({
      _id: parseId(req.params.guidanceId),
      ownerId: new ObjectId(req.auth.userId),
    });
    if (!result) throw new NotFoundError("Career guidance result not found");
    res.status(200).json({ success: true, data: result });
  }),
);

async function loadOwnedInputs(ownerId: string, resumeId: string, jobDescriptionId: string) {
  const ownerObjectId = new ObjectId(ownerId);
  return Promise.all([
    getDb().collection<ResumeDocument>("resumes").findOne({ _id: parseId(resumeId), ownerId: ownerObjectId }),
    getDb().collection<JobDescriptionDocument>("job_descriptions").findOne({
      _id: parseId(jobDescriptionId),
      ownerId: ownerObjectId,
    }),
  ]);
}

function parseId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new NotFoundError("Resource not found");
  return new ObjectId(id);
}

function safeDownloadName(value: string): string {
  const base = value.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 100);
  return base || "resume";
}

function acceptedJob(jobId: ObjectId, resultId: ObjectId | null) {
  return {
    jobId: jobId.toHexString(),
    status: "queued",
    statusUrl: `/api/v1/jobs/status/${jobId.toHexString()}`,
    ...(resultId ? { resultId: resultId.toHexString() } : {}),
  };
}

function matchResponse(match: JobMatchDocument) {
  const withdrawn = match.reviewStatus === "rejected";
  const modified = match.reviewStatus === "edited";
  return {
    id: match._id.toHexString(),
    resumeId: match.resumeId.toHexString(),
    jobDescriptionId: match.jobDescriptionId.toHexString(),
    score: withdrawn || modified ? null : match.score,
    scoreBreakdown: withdrawn || modified ? {} : match.scoreBreakdown,
    skillResults: withdrawn || modified ? [] : match.skillResults,
    disclaimer: withdrawn ? "This AI output was withdrawn after coach review." : match.disclaimer,
    scoreConfigVersion: match.scoreConfigVersion,
    reviewStatus: match.reviewStatus,
    reviewedOutput: match.reviewedOutput ?? null,
    flags: match.flags,
    createdAt: match.createdAt.toISOString(),
  };
}

function gapResponse(gap: SkillGapDocument) {
  return {
    id: gap._id.toHexString(),
    categories: gap.categories.map((category) => ({
      name: category.category,
      items: category.skills.map((skill) => ({
        skill,
        evidenceStatus: "no_evidence_found",
        suggestedActions: category.actions,
      })),
    })),
    skills: gap.skills,
    createdAt: gap.createdAt.toISOString(),
  };
}

function suggestionResponse(
  item: ResumeSuggestionDocument,
  applicationStatus = item.applicationStatus ?? "not_applied",
) {
  return {
    id: item._id.toHexString(),
    resumeId: item.resumeId.toHexString(),
    jobDescriptionId: item.jobDescriptionId?.toHexString() ?? null,
    originalText: item.originalText,
    proposedText: item.proposedText,
    reason: item.reason,
    sourceSnippet: item.sourceSnippet,
    sectionId: item.sectionId ?? null,
    entryId: item.entryId ?? null,
    bulletId: item.bulletId ?? null,
    field: item.field ?? null,
    operation: item.operation ?? null,
    sectionTitle: item.sectionTitle ?? null,
    locationLabel: item.locationLabel ?? null,
    jobRequirement: item.jobRequirement ?? null,
    needsUserInput: item.needsUserInput ?? null,
    userInput: item.userInput ?? null,
    applicationStatus,
    status: item.status,
    reviewStatus: item.reviewStatus,
    reviewedOutput: item.reviewedOutput ?? null,
    flags: item.flags,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function questionResponse(question: {
  _id: ObjectId;
  prompt: string;
  competency: string;
  type?: "technical" | "behavioral";
  difficulty: string;
}, index: number) {
  return {
    id: question._id.toHexString(),
    text: question.prompt,
    category: question.competency,
    type: question.type,
    difficulty: question.difficulty,
    index,
  };
}
