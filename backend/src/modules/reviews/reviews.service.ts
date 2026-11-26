import { ObjectId } from "mongodb";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";
import { getDb } from "../../infra/db/database.js";
import { recordAuditEvent } from "../users/audit-log.service.js";
import { startReviewGraph, resumeReviewGraph } from "../../graphs/review-escalation.graph.js";
import { roundToTwoDecimalPlaces } from "../../common/rounding.js";
import type {
  InterviewAnswerDocument,
  InterviewEvaluationDocument,
  InterviewQuestionDocument,
  JobMatchDocument,
  ResumeSuggestionDocument,
  ReviewItemDocument,
} from "../ai-results/models.js";

const reviewConfigPath = fileURLToPath(new URL("../../../config/review-thresholds.v1.json", import.meta.url));
const reviewDecisionSchema = z.object({
  decision: z.enum(["approve", "edit", "reject"]),
  reason: z.string().trim().min(1).max(2000),
  coachFeedback: z.string().trim().min(1).max(5000).optional(),
  editedText: z.string().trim().min(1).max(5000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "edit" && !value.editedText) {
    context.addIssue({ code: "custom", path: ["editedText"], message: "Edited text is required for edit decisions" });
  }
});

export async function shouldEscalate(
  confidence: number,
  flags: string[],
  candidateRequested = false,
): Promise<{ required: boolean; flags: string[]; riskLevel: ReviewItemDocument["riskLevel"] }> {
  const raw = JSON.parse(await readFile(reviewConfigPath, "utf8")) as unknown;
  const config = z.object({
    lowConfidenceThreshold: z.number().min(0).max(1),
    randomQualitySampleRate: z.number().min(0).max(1),
    alwaysFlag: z.array(z.string()),
  }).parse(raw);
  const allFlags = new Set(flags);
  if (confidence < config.lowConfidenceThreshold) allFlags.add("low_confidence");
  if (candidateRequested) allFlags.add("candidate_requested_review");
  const shouldSample = Math.random() < config.randomQualitySampleRate;
  if (shouldSample) allFlags.add("random_quality_sample");
  const required = shouldSample || [...allFlags].some((flag) => config.alwaysFlag.includes(flag)) ||
    allFlags.has("low_confidence");
  const severity = allFlags.has("fabrication_guardrail_hit") ||
    allFlags.has("possible_protected_trait_reference") ? "high" : allFlags.size > 0 ? "medium" : "low";
  return { required, flags: [...allFlags], riskLevel: severity };
}

export async function createReviewItem(input: {
  ownerId: ObjectId;
  targetType: ReviewItemDocument["targetType"];
  targetId: ObjectId;
  sourceJobDescriptionId?: ObjectId;
  targetContent?: string;
  flags: string[];
  riskLevel: ReviewItemDocument["riskLevel"];
  requestReason?: string | null;
}): Promise<ReviewItemDocument> {
  const now = new Date();
  const item: ReviewItemDocument = {
    _id: new ObjectId(),
    ownerId: input.ownerId,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.sourceJobDescriptionId ? { sourceJobDescriptionId: input.sourceJobDescriptionId } : {}),
    ...(input.targetContent ? { targetContent: input.targetContent } : {}),
    flags: input.flags,
    riskLevel: input.riskLevel,
    status: "pending_review",
    assignedCoachId: null,
    requestReason: input.requestReason ?? null,
    decisionReason: null,
    decisionText: null,
    coachFeedback: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().collection<ReviewItemDocument>("review_items").insertOne(item);
  await startReviewGraph({
    reviewId: item._id.toHexString(),
    ownerId: item.ownerId.toHexString(),
    targetId: item.targetId.toHexString(),
  });
  return item;
}

export async function requestReview(input: {
  ownerId: string;
  targetType: ReviewItemDocument["targetType"];
  targetId: string;
  reason: string;
}): Promise<ReviewItemDocument> {
  if (input.targetType === "resume_draft") {
    throw new ValidationError("Submit CV drafts through the dedicated coach-review flow");
  }
  if (!ObjectId.isValid(input.targetId)) throw new NotFoundError("Review target not found");
  const ownerId = new ObjectId(input.ownerId);
  const targetId = new ObjectId(input.targetId);
  const collectionByType = {
    job_match: "job_matches",
    resume_suggestion: "resume_suggestions",
    interview_evaluation: "interview_evaluations",
  } as const;
  const target = await getDb().collection(collectionByType[input.targetType]).findOne({ _id: targetId, ownerId });
  if (!target) throw new NotFoundError("Review target not found");
  const existing = await getDb().collection<ReviewItemDocument>("review_items").findOne({
    ownerId,
    targetType: input.targetType,
    targetId,
    status: { $in: ["pending_review", "in_review"] },
  });
  if (existing) {
    const updated = await getDb().collection<ReviewItemDocument>("review_items").findOneAndUpdate(
      { _id: existing._id, status: { $in: ["pending_review", "in_review"] } },
      { $set: { requestReason: input.reason, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) throw new ConflictError("Review item is no longer pending");
    return updated;
  }
  return createReviewItem({
    ownerId,
    targetType: input.targetType,
    targetId,
    flags: ["candidate_requested_review"],
    riskLevel: "medium",
    requestReason: input.reason,
  });
}

export async function requestResumeDraftReview(input: {
  ownerId: string;
  resumeId: string;
  jobDescriptionId: string;
  draftContent: string;
  reason: string;
}): Promise<ReviewItemDocument> {
  if (!ObjectId.isValid(input.resumeId) || !ObjectId.isValid(input.jobDescriptionId)) {
    throw new NotFoundError("Resume or job description not found");
  }
  const ownerId = new ObjectId(input.ownerId);
  const resumeId = new ObjectId(input.resumeId);
  const jobDescriptionId = new ObjectId(input.jobDescriptionId);
  const [resume, jobDescription] = await Promise.all([
    getDb().collection("resumes").findOne({ _id: resumeId, ownerId }),
    getDb().collection("job_descriptions").findOne({ _id: jobDescriptionId, ownerId }),
  ]);
  if (!resume || !jobDescription) throw new NotFoundError("Resume or job description not found");

  const existing = await getDb().collection<ReviewItemDocument>("review_items").findOne({
    ownerId,
    targetType: "resume_draft",
    targetId: resumeId,
    status: { $in: ["pending_review", "in_review"] },
  });
  if (existing) throw new ConflictError("A coach review is already pending for this CV");

  return createReviewItem({
    ownerId,
    targetType: "resume_draft",
    targetId: resumeId,
    sourceJobDescriptionId: jobDescriptionId,
    targetContent: input.draftContent,
    flags: ["candidate_requested_review"],
    riskLevel: "medium",
    requestReason: input.reason,
  });
}

export async function listPendingReviews(): Promise<ReviewItemDocument[]> {
  return getDb()
    .collection<ReviewItemDocument>("review_items")
    .find({ status: "pending_review" })
    .sort({ createdAt: 1 })
    .limit(100)
    .toArray();
}

export async function listMyReviews(ownerId: string): Promise<ReviewItemDocument[]> {
  return getDb()
    .collection<ReviewItemDocument>("review_items")
    .find({ ownerId: new ObjectId(ownerId) })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
}

export async function getReviewItem(
  id: string,
  actorId: string,
  actorRole: "candidate" | "coach" | "admin",
): Promise<ReviewItemDocument> {
  if (!ObjectId.isValid(id)) throw new NotFoundError("Review item not found");
  const item = await getDb().collection<ReviewItemDocument>("review_items")
    .findOne({ _id: new ObjectId(id) });
  if (!item) throw new NotFoundError("Review item not found");
  if (actorRole === "candidate" && item.ownerId.toHexString() !== actorId) {
    throw new NotFoundError("Review item not found");
  }
  if (actorRole === "coach" &&
      item.assignedCoachId &&
      item.assignedCoachId.toHexString() !== actorId) {
    throw new ForbiddenError("This review is assigned to another coach");
  }
  if (actorRole === "admin") throw new ForbiddenError("Administrators cannot access candidate review content");
  return item;
}

export async function getCoachReviewDetails(
  id: string,
  coachId: string,
): Promise<{
  review: ReturnType<typeof toReviewResponse>;
  target:
    | ({ type: "job_match" } & Pick<JobMatchDocument, "score" | "scoreBreakdown" | "skillResults" | "disclaimer">)
    | ({ type: "resume_suggestion" } & Pick<ResumeSuggestionDocument, "originalText" | "proposedText" | "reason" | "sourceSnippet">)
    | { type: "resume_draft"; content: string }
    | ({ type: "interview_evaluation" }
      & Pick<InterviewEvaluationDocument, "overallScore" | "dimensions" | "strengths" | "improvements" | "exampleAnswer" | "confidence">
      & { answers: Array<{ question: string; answer: string }> });
}> {
  const item = await getReviewItem(id, coachId, "coach");
  if (item.status !== "pending_review" && item.status !== "in_review") {
    throw new ConflictError("Review item is no longer pending");
  }

  if (item.targetType === "job_match") {
    const target = await getDb().collection<JobMatchDocument>("job_matches")
      .findOne({ _id: item.targetId, ownerId: item.ownerId });
    if (!target) throw new NotFoundError("Review target not found");
    return {
      review: toReviewResponse(item),
      target: {
        type: "job_match",
        score: target.score,
        scoreBreakdown: target.scoreBreakdown,
        skillResults: target.skillResults,
        disclaimer: target.disclaimer,
      },
    };
  }
  if (item.targetType === "resume_suggestion") {
    const target = await getDb().collection<ResumeSuggestionDocument>("resume_suggestions")
      .findOne({ _id: item.targetId, ownerId: item.ownerId });
    if (!target) throw new NotFoundError("Review target not found");
    return {
      review: toReviewResponse(item),
      target: {
        type: "resume_suggestion",
        originalText: target.originalText,
        proposedText: target.proposedText,
        reason: target.reason,
        sourceSnippet: target.sourceSnippet,
      },
    };
  }
  if (item.targetType === "resume_draft") {
    if (!item.targetContent) throw new NotFoundError("Submitted CV draft not found");
    return {
      review: toReviewResponse(item),
      target: { type: "resume_draft", content: item.targetContent },
    };
  }

  const evaluation = await getDb().collection<InterviewEvaluationDocument>("interview_evaluations")
    .findOne({ _id: item.targetId, ownerId: item.ownerId });
  if (!evaluation) throw new NotFoundError("Review target not found");
  const answers = await getDb().collection<InterviewAnswerDocument>("interview_answers")
    .find({ ownerId: item.ownerId, sessionId: evaluation.sessionId })
    .sort({ questionIndex: 1 })
    .toArray();
  const questions = await getDb().collection<InterviewQuestionDocument>("interview_questions")
    .find({ _id: { $in: answers.map((answer) => answer.questionId) }, ownerId: item.ownerId })
    .toArray();
  const questionsById = new Map(questions.map((question) => [question._id.toHexString(), question.prompt]));
  const answerDetails = answers.map((answer) => {
    const question = questionsById.get(answer.questionId.toHexString());
    if (!question) throw new NotFoundError("Review question not found");
    return { question, answer: answer.answerText };
  });
  return {
    review: toReviewResponse(item),
    target: {
      type: "interview_evaluation",
      overallScore: roundToTwoDecimalPlaces(evaluation.overallScore),
      dimensions: evaluation.dimensions.map((item) => ({
        ...item,
        score: roundToTwoDecimalPlaces(item.score),
      })),
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      exampleAnswer: evaluation.exampleAnswer,
      confidence: evaluation.confidence,
      answers: answerDetails,
    },
  };
}

export async function decideReview(input: {
  reviewId: string;
  coachId: string;
  body: unknown;
}): Promise<ReviewItemDocument> {
  const parsed = reviewDecisionSchema.safeParse(input.body);
  if (!parsed.success) throw new ValidationError("Review decision is invalid", parsed.error.flatten());
  if (!ObjectId.isValid(input.reviewId)) throw new NotFoundError("Review item not found");
  const id = new ObjectId(input.reviewId);
  const coachId = new ObjectId(input.coachId);
  const current = await getDb().collection<ReviewItemDocument>("review_items").findOne({
    _id: id,
    status: { $in: ["pending_review", "in_review"] },
  });
  if (!current) throw new ConflictError("Review item is no longer pending");
  if (current.targetType === "resume_draft" &&
      parsed.data.decision !== "edit" &&
      parsed.data.decision !== "reject") {
    throw new ValidationError("A CV draft review must include recommendations or be declined");
  }
  if (current.targetType === "resume_draft" &&
      parsed.data.decision === "edit" &&
      !parsed.data.editedText) {
    throw new ValidationError("Coach recommendations are required");
  }
  if (current.assignedCoachId && !current.assignedCoachId.equals(coachId)) {
    throw new ForbiddenError("This review is assigned to another coach");
  }
  const status = parsed.data.decision === "approve" ? "approved"
    : parsed.data.decision === "edit" ? "edited" : "rejected";
  const now = new Date();
  const result = await getDb().collection<ReviewItemDocument>("review_items").findOneAndUpdate(
    { _id: id, status: { $in: ["pending_review", "in_review"] } },
    {
      $set: {
        status,
        assignedCoachId: coachId,
        decisionReason: parsed.data.reason,
        decisionText: parsed.data.editedText ?? null,
        coachFeedback: parsed.data.coachFeedback ?? null,
        decidedBy: coachId,
        decidedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after", includeResultMetadata: false },
  );
  if (!result) throw new ConflictError("Review item was decided by another coach");

  await updateTargetReviewStatus(result, parsed.data.editedText);
  await recordAuditEvent({
    actorId: coachId,
    ownerId: result.ownerId,
    action: `review_${status}`,
    targetType: result.targetType,
    targetId: result.targetId,
    reason: parsed.data.reason,
    createdAt: now,
  });
  await resumeReviewGraph({
    reviewId: result._id.toHexString(),
    decisionId: result._id.toHexString(),
    status,
  });
  return result;
}

async function updateTargetReviewStatus(
  item: ReviewItemDocument,
  editedText: string | undefined,
): Promise<void> {
  if (item.targetType === "resume_draft") return;

  const collectionByType = {
    job_match: "job_matches",
    resume_suggestion: "resume_suggestions",
    interview_evaluation: "interview_evaluations",
  } as const;
  const update: Record<string, unknown> = {
    reviewStatus: item.status,
    updatedAt: new Date(),
  };
  if (item.targetType === "resume_suggestion" && editedText) {
    update.proposedText = editedText;
  }
  await getDb().collection(collectionByType[item.targetType]).updateOne(
    { _id: item.targetId, ownerId: item.ownerId },
    { $set: update },
  );
}

export function toReviewResponse(item: ReviewItemDocument) {
  return {
    id: item._id.toHexString(),
    targetType: item.targetType,
    targetId: item.targetId.toHexString(),
    sourceJobDescriptionId: item.sourceJobDescriptionId?.toHexString() ?? null,
    flags: item.flags,
    riskLevel: item.riskLevel,
    status: item.status,
    assignedCoachId: item.assignedCoachId?.toHexString() ?? null,
    requestReason: item.requestReason,
    decisionReason: item.decisionReason,
    decisionText: item.decisionText,
    coachFeedback: item.coachFeedback ?? null,
    videoUrl: item.videoKey ? `/api/v1/reviews/video/${encodeURIComponent(item.videoKey)}` : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
