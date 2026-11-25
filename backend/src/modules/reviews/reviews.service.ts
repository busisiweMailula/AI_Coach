import { ObjectId } from "mongodb";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { getDb } from "../../infra/db/database.js";
import { startReviewGraph, resumeReviewGraph } from "../../graphs/review-escalation.graph.js";
import { ensureHumanReviewConsent, hasHumanReviewConsent } from "../privacy/privacy.service.js";
import { getOriginalResumeFile } from "../resumes/resumes.service.js";
import { recordAuditEvent } from "../users/audit-log.service.js";
import { notify, notifyActiveRole } from "../notifications/notifications.service.js";
import type { UserDocument } from "../users/user.model.js";
import type { ResumeDocument } from "../resumes/resume.model.js";
import type { JobDescriptionDocument } from "../jobs/job-description.model.js";
import type {
  InterviewAnswerDocument,
  InterviewEvaluationDocument,
  InterviewQuestionDocument,
  InterviewSessionDocument,
  JobMatchDocument,
  QuestionSetDocument,
  ReviewHistoryDocument,
  ResumeSuggestionDocument,
  ReviewItemDocument,
} from "../ai-results/models.js";

const reviewConfigPath = fileURLToPath(new URL("../../../config/review-thresholds.v1.json", import.meta.url));
const reviewDecisionSchema = z.object({
  decision: z.enum(["approve", "modify", "edit", "reject"]),
  reason: z.string().trim().min(1).max(2000),
  modifiedOutput: z.string().trim().min(1).max(5000).optional(),
  coachFeedback: z.string().trim().min(1).max(5000).optional(),
  editedText: z.string().trim().min(1).max(5000).optional(),
  recommendations: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  internalNote: z.string().trim().max(2000).optional(),
}).strict().superRefine((value, context) => {
  if ((value.decision === "modify" || value.decision === "edit") &&
      !(value.modifiedOutput ?? value.editedText)?.trim()) {
    context.addIssue({ code: "custom", path: ["modifiedOutput"], message: "Modified output is required for modify decisions" });
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
  flags: string[];
  riskLevel: ReviewItemDocument["riskLevel"];
  requestReason?: string | null;
}): Promise<ReviewItemDocument | null> {
  if (!await hasHumanReviewConsent(input.ownerId)) {
    const collectionByType = {
      job_match: "job_matches",
      resume_suggestion: "resume_suggestions",
      interview_evaluation: "interview_evaluations",
    } as const;
    await getDb().collection(collectionByType[input.targetType]).updateOne(
      { _id: input.targetId, ownerId: input.ownerId },
      { $set: { reviewStatus: "not_required", updatedAt: new Date() } },
    );
    return null;
  }
  const now = new Date();
  const item: ReviewItemDocument = {
    _id: new ObjectId(),
    ownerId: input.ownerId,
    targetType: input.targetType,
    targetId: input.targetId,
    flags: input.flags,
    riskLevel: input.riskLevel,
    status: "pending_review",
    assignedCoachId: null,
    claimedAt: null,
    requestReason: input.requestReason ?? null,
    decisionReason: null,
    decisionText: null,
    modifiedOutput: null,
    originalOutput: null,
    recommendations: [],
    internalNote: null,
    coachFeedback: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().collection<ReviewItemDocument>("review_items").insertOne(item);
  await addReviewHistory(item._id, null, "created", input.requestReason ?? null, now);
  await startReviewGraph({
    reviewId: item._id.toHexString(),
    ownerId: item.ownerId.toHexString(),
    targetId: item.targetId.toHexString(),
  });
  await notifyActiveRole({
    role: "coach",
    type: "review_new",
    title: "New review in the queue",
    message: "A new item is available for coach review.",
    link: `/reviews/${item._id.toHexString()}`,
    entityType: "review",
    entityId: item._id,
    dedupeKey: `review:${item._id.toHexString()}:created`,
  });
  return item;
}

export async function requestReview(input: {
  ownerId: string;
  targetType: ReviewItemDocument["targetType"];
  targetId: string;
  reason: string;
}): Promise<ReviewItemDocument> {
  await ensureHumanReviewConsent(input.ownerId);
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
  const created = await createReviewItem({
    ownerId,
    targetType: input.targetType,
    targetId,
    flags: ["candidate_requested_review"],
    riskLevel: "medium",
    requestReason: input.reason,
  });
  if (!created) throw new ForbiddenError("Consent to human review is required");
  return created;
}

export interface ReviewQueueOptions {
  search: string;
  type: ReviewItemDocument["targetType"] | "";
  risk: ReviewItemDocument["riskLevel"] | "";
  sort: "oldest" | "highest_risk";
  page: number;
  pageSize: number;
}

export async function listPendingReviews(coachId: string, options: ReviewQueueOptions) {
  const items = await getDb().collection<ReviewItemDocument>("review_items")
    .find({ status: { $in: ["pending_review", "in_review"] } })
    .sort({ createdAt: 1 })
    .toArray();
  const rows = [];
  for (const item of items) {
    if (item.status === "in_review" && item.assignedCoachId?.toHexString() !== coachId &&
        item.claimedAt && item.claimedAt.getTime() > Date.now() - env.REVIEW_CLAIM_TIMEOUT_MS) continue;
    if (!await hasHumanReviewConsent(item.ownerId)) continue;
    const context = await getReviewContext(item);
    if (!context) continue;
    if (options.type && item.targetType !== options.type) continue;
    if (options.risk && item.riskLevel !== options.risk) continue;
    const searchable = [
      context.candidate.displayName, context.candidate.email, context.job?.title,
      context.resume?.fileName, ...item.flags.map(describeReviewFlag),
    ].join(" ").toLocaleLowerCase("en");
    if (options.search && !searchable.includes(options.search.toLocaleLowerCase("en"))) continue;
    rows.push({
      ...toReviewResponse(item),
      candidate: { displayName: context.candidate.displayName, email: context.candidate.email },
      jobTitle: context.job?.title ?? null,
      resumeName: context.resume?.title || context.resume?.fileName || null,
      flagReasons: item.flags.map(describeReviewFlag),
      waitingSeconds: Math.max(0, Math.floor((Date.now() - item.createdAt.getTime()) / 1000)),
    });
  }
  rows.sort((a, b) => options.sort === "highest_risk"
    ? riskRank(b.riskLevel) - riskRank(a.riskLevel) || a.createdAt.localeCompare(b.createdAt)
    : a.createdAt.localeCompare(b.createdAt));
  const start = (options.page - 1) * options.pageSize;
  return {
    items: rows.slice(start, start + options.pageSize),
    total: rows.length,
    page: options.page,
    pageSize: options.pageSize,
    nextPage: start + options.pageSize < rows.length ? options.page + 1 : null,
  };
}

export async function listCandidateReviews(ownerId: string): Promise<ReviewItemDocument[]> {
  return getDb()
    .collection<ReviewItemDocument>("review_items")
    .find({ ownerId: new ObjectId(ownerId) })
    .sort({ createdAt: -1 })
    .limit(50)
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
      item.assignedCoachId.toHexString() !== actorId &&
      item.status === "in_review" &&
      item.claimedAt &&
      item.claimedAt.getTime() > Date.now() - env.REVIEW_CLAIM_TIMEOUT_MS) {
    throw new ForbiddenError("This review is assigned to another coach");
  }
  if (actorRole === "admin") throw new ForbiddenError("Administrators cannot access candidate review content");
  return item;
}

export async function getCoachReviewDetails(
  id: string,
  coachId: string,
  options?: { view?: "cv" | "job_description" },
): Promise<ReviewContext> {
  let item = await getReviewItem(id, coachId, "coach");
  if (item.status === "pending_review" ||
      (item.status === "in_review" && !item.assignedCoachId)) {
    item = await claimReview(id, coachId);
  }
  assertCoachCanAccessReview(item, coachId);
  await ensureHumanReviewConsent(item.ownerId);
  const context = await getReviewContext(item);
  if (!context) throw new NotFoundError("Review target not found");
  const action = options?.view === "cv"
    ? "coach_view_cv_drawer"
    : options?.view === "job_description"
      ? "coach_view_job_description_drawer"
      : "coach_review_context_viewed";
  await recordAuditEvent({
    actorId: new ObjectId(coachId),
    ownerId: item.ownerId,
    targetId: item._id,
    targetType: options?.view ? `${options.view}_drawer` : item.targetType,
    action,
  });
  return {
    review: toCoachReviewResponse(item),
    ...context,
    history: await getReviewHistory(item._id),
  };
}

export async function claimReview(reviewId: string, coachId: string): Promise<ReviewItemDocument> {
  if (!ObjectId.isValid(reviewId)) throw new NotFoundError("Review item not found");
  const id = new ObjectId(reviewId);
  const coachObjectId = new ObjectId(coachId);
  const collection = getDb().collection<ReviewItemDocument>("review_items");
  const current = await collection.findOne({ _id: id });
  if (!current) throw new NotFoundError("Review item not found");
  await ensureHumanReviewConsent(current.ownerId);
  if (current.status !== "pending_review" && current.status !== "in_review") {
    throw new ConflictError("Review item is no longer available");
  }
  if (current.status === "in_review" && current.assignedCoachId?.equals(coachObjectId)) return current;
  const isExpired = current.status === "in_review" &&
    (!current.claimedAt || current.claimedAt.getTime() <= Date.now() - env.REVIEW_CLAIM_TIMEOUT_MS);
  if (current.status === "in_review" && !isExpired) {
    throw new ForbiddenError("This review is assigned to another coach");
  }
  const now = new Date();
  const filter = current.status === "pending_review"
    ? { _id: id, status: "pending_review" }
    : {
        _id: id,
        status: "in_review",
        assignedCoachId: current.assignedCoachId,
        claimedAt: current.claimedAt ?? null,
      };
  const claimed = await collection.findOneAndUpdate(
    filter,
    { $set: { status: "in_review", assignedCoachId: coachObjectId, claimedAt: now, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!claimed) throw new ConflictError("Another coach claimed this review. Refresh the queue.");
  await addReviewHistory(id, coachObjectId, isExpired ? "reassigned" : "claimed", null, now);
  if (isExpired && current.assignedCoachId) {
    await notify({
      recipientUserId: current.assignedCoachId,
      type: "review_released",
      title: "Review returned to the queue",
      message: "A review you claimed was released and is available to other coaches.",
      link: "/reviews",
      entityType: "review",
      entityId: id,
      dedupeKey: `review:${id.toHexString()}:claim-expired:${current.claimedAt?.getTime() ?? 0}`,
    });
  }
  await recordAuditEvent({
    actorId: coachObjectId,
    ownerId: current.ownerId,
    targetId: id,
    targetType: current.targetType,
    action: isExpired ? "review_reassigned" : "review_claimed",
  });
  return claimed;
}

export async function releaseReview(reviewId: string, actorId: string, actorRole: "coach" | "admin") {
  if (!ObjectId.isValid(reviewId)) throw new NotFoundError("Review item not found");
  const id = new ObjectId(reviewId);
  const collection = getDb().collection<ReviewItemDocument>("review_items");
  const current = await collection.findOne({ _id: id, status: "in_review" });
  if (!current) throw new ConflictError("Review is not currently claimed");
  if (actorRole === "coach" && current.assignedCoachId?.toHexString() !== actorId) {
    throw new ForbiddenError("Only the claiming coach can release this review");
  }
  const updated = await collection.findOneAndUpdate(
    { _id: id, status: "in_review", assignedCoachId: current.assignedCoachId, claimedAt: current.claimedAt ?? null },
    { $set: { status: "pending_review", assignedCoachId: null, claimedAt: null, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) throw new ConflictError("Review claim changed; refresh and try again");
  const actorObjectId = new ObjectId(actorId);
  await addReviewHistory(id, actorObjectId, "released", null);
  await recordAuditEvent({
    actorId: actorObjectId,
    ownerId: current.ownerId,
    targetId: id,
    targetType: current.targetType,
    action: "review_released",
  });
  await notifyActiveRole({
    role: "coach",
    type: "review_released",
    title: "Review returned to the queue",
    message: "A review is available for a coach to claim.",
    link: `/reviews/${id.toHexString()}`,
    entityType: "review",
    entityId: id,
    dedupeKey: `review:${id.toHexString()}:released:${Date.now()}`,
  });
  return updated;
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
  const collection = getDb().collection<ReviewItemDocument>("review_items");
  const current = await collection.findOne({ _id: id });
  if (!current) throw new NotFoundError("Review item not found");
  if (["approved", "edited", "rejected"].includes(current.status)) {
    if (current.decidedBy?.equals(coachId)) return current;
    throw new ConflictError("Review item has already been decided");
  }
  if (current.status !== "in_review" || !current.assignedCoachId?.equals(coachId)) {
    throw new ForbiddenError("Claim this review before submitting a decision");
  }
  await ensureHumanReviewConsent(current.ownerId);
  const decision = parsed.data.decision === "edit" ? "modify" : parsed.data.decision;
  const modifiedOutput = parsed.data.modifiedOutput ?? parsed.data.editedText;
  const status = decision === "approve" ? "approved" : decision === "modify" ? "edited" : "rejected";
  const originalOutput = await captureOriginalOutput(current);
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    { _id: id, status: "in_review", assignedCoachId: coachId, claimedAt: current.claimedAt ?? null },
    {
      $set: {
        status,
        decisionReason: parsed.data.reason,
        coachFeedback: parsed.data.coachFeedback ?? null,
        decisionText: modifiedOutput ?? null,
        modifiedOutput: decision === "modify" ? modifiedOutput ?? null : null,
        originalOutput,
        recommendations: parsed.data.recommendations,
        internalNote: parsed.data.internalNote ?? null,
        decidedBy: coachId,
        decidedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!result) throw new ConflictError("Review item was decided by another coach");

  await updateTargetReviewStatus(result, modifiedOutput);
  await getDb().collection("audit_logs").insertOne({
    _id: new ObjectId(),
    actorId: coachId,
    ownerId: result.ownerId,
    action: `review_${status}`,
    targetType: result.targetType,
    targetId: result.targetId,
    createdAt: now,
  });
  await addReviewHistory(id, coachId, `decision_${status}`, parsed.data.reason, now);
  await notify({
    recipientUserId: result.ownerId,
    type: "coach_reviewed",
    title: "Your coach has reviewed your item",
    message: `Your coach reviewed your ${reviewTypeLabel(result.targetType)}.`,
    link: `/coach-feedback/${id.toHexString()}`,
    entityType: "review",
    entityId: id,
    dedupeKey: `review:${id.toHexString()}:candidate-decision`,
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
  modifiedOutput: string | undefined,
): Promise<void> {
  const collectionByType = {
    job_match: "job_matches",
    resume_suggestion: "resume_suggestions",
    interview_evaluation: "interview_evaluations",
  } as const;
  const update: Record<string, unknown> = {
    reviewStatus: item.status,
    updatedAt: new Date(),
  };
  if (item.targetType === "resume_suggestion" && item.status === "rejected") {
    update.status = "rejected";
    update.applicationStatus = "not_applied";
  }
  if (item.status === "edited" && modifiedOutput) {
    update.reviewedOutput = modifiedOutput;
    if (item.targetType === "resume_suggestion") update.proposedText = modifiedOutput;
  }
  await getDb().collection(collectionByType[item.targetType]).updateOne(
    { _id: item.targetId, ownerId: item.ownerId },
    { $set: update },
  );
  if (item.targetType === "interview_evaluation") {
    const evaluation = await getDb().collection<InterviewEvaluationDocument>("interview_evaluations")
      .findOne({ _id: item.targetId, ownerId: item.ownerId });
    if (evaluation) {
      await getDb().collection<InterviewSessionDocument>("interview_sessions").updateOne(
        { _id: evaluation.sessionId, ownerId: item.ownerId },
        { $set: { reviewStatus: item.status, updatedAt: new Date() } },
      );
    }
  }
}

export function toReviewResponse(item: ReviewItemDocument) {
  return {
    id: item._id.toHexString(),
    targetType: item.targetType,
    targetId: item.targetId.toHexString(),
    flags: item.flags,
    riskLevel: item.riskLevel,
    status: item.status,
    assignedCoachId: item.assignedCoachId?.toHexString() ?? null,
    claimedAt: item.claimedAt?.toISOString() ?? null,
    requestReason: item.requestReason,
    decisionReason: item.decisionReason,
    decisionText: item.decisionText,
    modifiedOutput: item.modifiedOutput ?? null,
    recommendations: item.recommendations ?? [],
    decidedBy: item.decidedBy?.toHexString() ?? null,
    decidedAt: item.decidedAt?.toISOString() ?? null,
    coachFeedback: item.coachFeedback ?? null,
    videoUrl: item.videoKey ? `/api/v1/reviews/video/${encodeURIComponent(item.videoKey)}` : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

type ReviewTarget =
  | ({ type: "job_match" } & Pick<JobMatchDocument, "score" | "scoreBreakdown" | "skillResults" | "disclaimer" | "flags" | "confidence" | "reviewedOutput">)
  | ({ type: "resume_suggestion" } & Pick<ResumeSuggestionDocument, "originalText" | "proposedText" | "reason" | "sourceSnippet" | "jobRequirement" | "reviewedOutput">)
  | ({ type: "interview_evaluation" }
    & Pick<InterviewEvaluationDocument, "overallScore" | "dimensions" | "strengths" | "improvements" | "exampleAnswer" | "confidence" | "reviewedOutput">
    & { answers: Array<{ question: string; answer: string }> });

type ReviewContextParts = {
  candidate: { id: string; displayName: string; email: string; registeredAt: string };
  job: {
    id?: string;
    title: string;
    company: string | null;
    text: string;
    requiredSkills?: Array<string | { name: string; evidenceSnippet?: string }>;
    createdAt: string;
  } | null;
  resume: {
    id: string;
    fileName: string;
    title: string | null;
    createdAt: string;
    extractedText: string;
    structuredCv: ResumeDocument["structuredCv"] | null;
    fileLink: string;
  } | null;
  target: ReviewTarget;
};

type ReviewContext = {
  review: ReturnType<typeof toReviewResponse> & { internalNote: string | null };
  candidate: ReviewContextParts["candidate"];
  job: ReviewContextParts["job"];
  resume: ReviewContextParts["resume"];
  target: ReviewTarget;
  history: Array<{ action: string; actor: string; createdAt: string; details: string | null }>;
};

async function getReviewContext(item: ReviewItemDocument): Promise<ReviewContextParts | null> {
  const db = getDb();
  let resumeId: ObjectId | null = null;
  let jobDescriptionId: ObjectId | null = null;
  let target: ReviewTarget;
  if (item.targetType === "job_match") {
    const match = await db.collection<JobMatchDocument>("job_matches")
      .findOne({ _id: item.targetId, ownerId: item.ownerId });
    if (!match) return null;
    resumeId = match.resumeId;
    jobDescriptionId = match.jobDescriptionId;
    target = {
      type: "job_match",
      score: match.score,
      scoreBreakdown: match.scoreBreakdown,
      skillResults: match.skillResults,
      disclaimer: match.disclaimer,
      flags: match.flags,
      confidence: match.confidence,
      reviewedOutput: match.reviewedOutput,
    };
  } else if (item.targetType === "resume_suggestion") {
    const suggestion = await db.collection<ResumeSuggestionDocument>("resume_suggestions")
      .findOne({ _id: item.targetId, ownerId: item.ownerId });
    if (!suggestion) return null;
    resumeId = suggestion.resumeId;
    jobDescriptionId = suggestion.jobDescriptionId;
    target = {
      type: "resume_suggestion",
      originalText: suggestion.originalText,
      proposedText: suggestion.proposedText,
      reason: suggestion.reason,
      sourceSnippet: suggestion.sourceSnippet,
      jobRequirement: suggestion.jobRequirement,
      reviewedOutput: suggestion.reviewedOutput,
    };
  } else {
    const evaluation = await db.collection<InterviewEvaluationDocument>("interview_evaluations")
      .findOne({ _id: item.targetId, ownerId: item.ownerId });
    if (!evaluation) return null;
    const session = await db.collection<InterviewSessionDocument>("interview_sessions")
      .findOne({ _id: evaluation.sessionId, ownerId: item.ownerId });
    const answers = await db.collection<InterviewAnswerDocument>("interview_answers")
      .find({ ownerId: item.ownerId, sessionId: evaluation.sessionId })
      .sort({ questionIndex: 1 })
      .toArray();
    const questions = await db.collection<InterviewQuestionDocument>("interview_questions")
      .find({ _id: { $in: answers.map((answer) => answer.questionId) }, ownerId: item.ownerId })
      .toArray();
    const questionsById = new Map(questions.map((question) => [question._id.toHexString(), question]));
    const answerDetails = answers.map((answer) => {
      const question = questionsById.get(answer.questionId.toHexString());
      if (!question) throw new NotFoundError("Review question not found");
      return { question: question.prompt, answer: answer.answerText };
    });
    const questionSetId = questions.find((question) => question.questionSetId)?.questionSetId;
    if (questionSetId) {
      const questionSet = await db.collection<QuestionSetDocument>("interview_question_sets")
        .findOne({ _id: questionSetId, ownerId: item.ownerId });
      resumeId = questionSet?.resumeId ?? null;
      jobDescriptionId = questionSet?.jobDescriptionId ?? null;
    }
    target = {
      type: "interview_evaluation",
      overallScore: evaluation.overallScore,
      dimensions: evaluation.dimensions,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      exampleAnswer: evaluation.exampleAnswer,
      confidence: evaluation.confidence,
      reviewedOutput: evaluation.reviewedOutput,
      answers: answerDetails,
    };
  }

  const [user, resume, job] = await Promise.all([
    db.collection<UserDocument>("users").findOne({ _id: item.ownerId }),
    resumeId
      ? db.collection<ResumeDocument>("resumes").findOne({ _id: resumeId, ownerId: item.ownerId })
      : Promise.resolve(null),
    jobDescriptionId
      ? db.collection<JobDescriptionDocument>("job_descriptions")
        .findOne({ _id: jobDescriptionId, ownerId: item.ownerId })
      : Promise.resolve(null),
  ]);
  if (!user) throw new NotFoundError("Candidate account not found");
  return {
    candidate: {
      id: user._id.toHexString(),
      displayName: resume?.structuredCv?.header.name.trim() || displayNameFromEmail(user.email),
      email: user.email,
      registeredAt: user.createdAt.toISOString(),
    },
    job: job ? {
      id: job._id.toHexString(),
      title: job.roleTitle?.trim() || "Job description",
      company: null,
      text: job.rawText,
      requiredSkills: job.requiredSkills ?? [],
      createdAt: job.createdAt.toISOString(),
    } : null,
    resume: resume ? {
      id: resume._id.toHexString(),
      fileName: resume.originalFileName,
      title: resume.title ?? null,
      createdAt: resume.createdAt.toISOString(),
      extractedText: resume.extractedText,
      structuredCv: resume.structuredCv ?? null,
      fileLink: `/api/v1/reviews/${item._id.toHexString()}/resume-file`,
    } : null,
    target,
  };
}

export async function getReviewResumeFile(reviewId: string, coachId: string) {
  const item = await getReviewItem(reviewId, coachId, "coach");
  assertCoachCanAccessReview(item, coachId);
  await ensureHumanReviewConsent(item.ownerId);
  const context = await getReviewContext(item);
  if (!context?.resume) throw new NotFoundError("CV file not found");
  const resume = await getDb().collection<ResumeDocument>("resumes")
    .findOne({ _id: new ObjectId(context.resume.id), ownerId: item.ownerId });
  if (!resume) throw new NotFoundError("CV file not found");
  await recordAuditEvent({
    actorId: new ObjectId(coachId),
    ownerId: item.ownerId,
    targetId: item._id,
    targetType: "resume_file",
    action: "coach_review_cv_file_accessed",
  });
  return {
    fileName: resume.originalFileName,
    contentType: resume.contentType,
    buffer: await getOriginalResumeFile(resume),
  };
}

export async function withdrawPendingReviews(ownerId: string): Promise<void> {
  const ownerObjectId = new ObjectId(ownerId);
  const collection = getDb().collection<ReviewItemDocument>("review_items");
  const items = await collection.find({
    ownerId: ownerObjectId,
    status: { $in: ["pending_review", "in_review"] },
  }).toArray();
  for (const item of items) {
    const withdrawn = await collection.findOneAndUpdate(
      { _id: item._id, ownerId: ownerObjectId, status: item.status },
      { $set: { status: "withdrawn", assignedCoachId: null, claimedAt: null, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!withdrawn) continue;
    const collectionByType = {
      job_match: "job_matches",
      resume_suggestion: "resume_suggestions",
      interview_evaluation: "interview_evaluations",
    } as const;
    await getDb().collection(collectionByType[item.targetType]).updateOne(
      { _id: item.targetId, ownerId: ownerObjectId },
      { $set: { reviewStatus: "not_required", updatedAt: new Date() } },
    );
    await addReviewHistory(item._id, null, "withdrawn", "Human-review consent withdrawn");
    if (item.assignedCoachId) {
      await notify({
        recipientUserId: item.assignedCoachId,
        type: "review_withdrawn",
        title: "Review removed from your queue",
        message: "A claimed item is no longer available for review.",
        link: "/reviews",
        entityType: "review",
        entityId: item._id,
        dedupeKey: `review:${item._id.toHexString()}:withdrawn`,
      });
    }
  }
}


export async function getCandidateReviewDetails(reviewId: string, ownerId: string) {
  const item = await getReviewItem(reviewId, ownerId, "candidate");
  if (!["approved", "edited", "rejected"].includes(item.status)) {
    throw new NotFoundError("Coach feedback not found");
  }
  const context = await getReviewContext(item);
  if (!context) throw new NotFoundError("Reviewed item not found");
  const coach = item.decidedBy
    ? await getDb().collection<UserDocument>("users").findOne({ _id: item.decidedBy })
    : null;
  return {
    review: toReviewResponse(item),
    coachName: coach?.email ?? "Your coach",
    decisionLabel: item.status === "approved" ? "Approved" : item.status === "edited" ? "Modified" : "Rejected",
    reason: item.decisionReason,
    recommendations: item.recommendations ?? [],
    originalOutput: item.originalOutput,
    modifiedOutput: item.modifiedOutput,
    target: context.target,
  };
}

export async function getCoachDashboard(coachId: string) {
  const all = await getDb().collection<ReviewItemDocument>("review_items").find({}).toArray();
  const now = Date.now();
  const mine = all.filter((item) => item.decidedBy?.toHexString() === coachId &&
    item.decidedAt && item.decidedAt.getTime() >= now - 7 * 24 * 60 * 60 * 1000);
  const queue = all.filter((item) => item.status === "pending_review" || item.status === "in_review");
  const ownActive = queue.filter((item) => item.assignedCoachId?.toHexString() === coachId);
  const unclaimed = queue.filter((item) => item.status === "pending_review");
  const turnarounds = all.filter((item) => item.decidedBy?.toHexString() === coachId && item.decidedAt)
    .map((item) => (item.decidedAt!.getTime() - item.createdAt.getTime()) / 60_000);
  const avgTurnaroundMinutes = turnarounds.length
    ? Math.round(turnarounds.reduce((sum, value) => sum + value, 0) / turnarounds.length)
    : null;
  const waiting = unclaimed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  return {
    pending: unclaimed.length,
    inReviewByMe: ownActive.length,
    completedToday: mine.filter((item) => item.decidedAt!.toDateString() === new Date().toDateString()).length,
    completedThisWeek: mine.length,
    avgTurnaroundMinutes,
    oldestWaitingAt: waiting?.createdAt.toISOString() ?? null,
    oldestWaitingId: waiting?._id.toHexString() ?? null,
    byType: countBy(queue, (item) => item.targetType),
    byRisk: countBy(queue, (item) => item.riskLevel),
    recentDecisions: all.filter((item) => item.decidedBy?.toHexString() === coachId)
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))
      .slice(0, 10).map(toReviewResponse),
    nextInQueueId: unclaimed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?._id.toHexString() ?? null,
  };
}

async function captureOriginalOutput(item: ReviewItemDocument): Promise<string> {
  const context = await getReviewContext(item);
  if (!context) throw new NotFoundError("Review target not found");
  const target = context.target;
  if (target.type === "job_match") {
    return `Indicative match score: ${target.score}%\n${target.disclaimer}\n` +
      target.skillResults.map((skill) =>
        `${skill.name}: ${skill.status}${skill.evidenceSnippet ? ` — “${skill.evidenceSnippet}”` : ""}`).join("\n");
  }
  if (target.type === "resume_suggestion") {
    return `Original: ${target.originalText}\nAI recommendation: ${target.proposedText}\nReason: ${target.reason}`;
  }
  return `Overall score: ${target.overallScore}%\n` +
    target.dimensions.map((dimension) => `${dimension.dimension} (${dimension.score}/4): ${dimension.feedback}`).join("\n");
}

async function addReviewHistory(
  reviewId: ObjectId,
  actorId: ObjectId | null,
  action: string,
  details: string | null,
  createdAt = new Date(),
): Promise<void> {
  await getDb().collection<ReviewHistoryDocument>("review_history").insertOne({
    _id: new ObjectId(),
    reviewId,
    actorId,
    action,
    details,
    createdAt,
  });
}

async function getReviewHistory(reviewId: ObjectId) {
  const history = await getDb().collection<ReviewHistoryDocument>("review_history")
    .find({ reviewId })
    .sort({ createdAt: 1 })
    .toArray();
  const actorIds = history.flatMap((entry) => entry.actorId ? [entry.actorId] : []);
  const users = actorIds.length
    ? await getDb().collection<UserDocument>("users").find({ _id: { $in: actorIds } }).toArray()
    : [];
  const emailById = new Map(users.map((user) => [user._id.toHexString(), user.email]));
  return history.map((entry) => ({
    action: entry.action,
    actor: entry.actorId ? emailById.get(entry.actorId.toHexString()) ?? "Account" : "System",
    createdAt: entry.createdAt.toISOString(),
    details: entry.details,
  }));
}

function toCoachReviewResponse(item: ReviewItemDocument) {
  return { ...toReviewResponse(item), internalNote: item.internalNote ?? null };
}

function describeReviewFlag(flag: string): string {
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

function riskRank(risk: ReviewItemDocument["riskLevel"]): number {
  return risk === "high" ? 3 : risk === "medium" ? 2 : 1;
}

function displayNameFromEmail(email: string): string {
  return email.split("@")[0]?.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("en")) || "Candidate";
}

function reviewTypeLabel(type: ReviewItemDocument["targetType"]): string {
  return type === "job_match" ? "job match"
    : type === "resume_suggestion" ? "CV suggestions"
      : "interview evaluation";
}

function countBy<T>(items: T[], keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export interface DeterministicCvSummary {
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
}

export interface DeterministicJobSummary {
  id: string | null;
  title: string;
  company: string | null;
  location: string | null;
  topSkills: string[];
  dateAdded: string | null;
}

export interface ReviewSummaryResponse {
  reviewId: string;
  status: ReviewItemDocument["status"];
  account: {
    name: string;
    email: string;
    registeredDate: string;
    reviewType: ReviewItemDocument["targetType"];
    reviewTypeLabel: string;
    riskLevel: ReviewItemDocument["riskLevel"];
    flagReason: string;
    flagReasons: string[];
    waitingTime: string;
    waitingSeconds: number;
    createdAt: string;
  };
  cv: DeterministicCvSummary | null;
  job: DeterministicJobSummary | null;
}

export function formatWaitingTime(date: Date | string): { text: string; seconds: number; minutes: number } {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let text: string;
  if (days > 0) {
    text = `${days}d ${hours % 24}h waiting`;
  } else if (hours > 0) {
    text = `${hours}h ${minutes % 60}m waiting`;
  } else if (minutes > 0) {
    text = `${minutes}m waiting`;
  } else {
    text = "Just now";
  }
  return { text, seconds, minutes };
}

export function buildDeterministicCvSummary(
  resume: ResumeDocument | {
    _id?: ObjectId;
    originalFileName?: string;
    fileName?: string;
    title?: string | null;
    createdAt?: Date | string;
    structuredCv?: ResumeDocument["structuredCv"] | null;
    extractedText?: string;
    parsedData?: { skills?: string[] };
  } | null | undefined,
): DeterministicCvSummary | null {
  if (!resume) return null;
  const fileName = (resume as ResumeDocument).originalFileName || (resume as { fileName?: string }).fileName || "resume.pdf";
  const title = resume.title ?? null;
  const uploadDate = resume.createdAt ? new Date(resume.createdAt).toISOString() : null;
  const structured = resume.structuredCv;

  if (structured && structured.sections && structured.sections.length > 0) {
    let headline = structured.header?.headline?.trim() || null;
    if (!headline && structured.header?.sourceLines && structured.header.sourceLines.length > 1) {
      headline = structured.header.sourceLines[1]?.text?.trim() || null;
    }
    if (!headline) {
      const firstSec = structured.sections[0];
      if (firstSec && (firstSec.type === "custom" || firstSec.type === "summary")) {
        const p = firstSec.paragraphs[0]?.text?.trim();
        if (p && p.length < 120 && !/experience|education|skills/i.test(p)) {
          headline = p;
        }
      }
    }
    if (!headline) {
      const rawLines = (resume.extractedText || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (rawLines.length > 1 && rawLines[1].length < 100 && !/summary|experience|skills|education/i.test(rawLines[1])) {
        headline = rawLines[1];
      }
    }

    const firstLineUpper = (resume.extractedText || "").split(/\r?\n/)[0]?.trim().toUpperCase();
    const candidateName = (structured.header?.name?.trim() || firstLineUpper)?.toUpperCase();
    const detectedSections = structured.sections
      .map((s) => s.heading?.trim())
      .filter((h): h is string => Boolean(h) && h !== headline && h.toUpperCase() !== candidateName);

    const experienceSections = structured.sections.filter(
      (s) => s.type === "experience" || /experience|employment|work\s+history/i.test(s.heading),
    );
    const roles: Array<{ title: string; company: string }> = [];
    for (const sec of experienceSections) {
      if (sec.entries && sec.entries.length > 0) {
        for (const entry of sec.entries) {
          if (entry.title?.trim() || entry.company?.trim()) {
            roles.push({
              title: entry.title?.trim() || "Role",
              company: entry.company?.trim() || "Company",
            });
          }
        }
      }
      if (roles.length === 0) {
        for (const p of sec.paragraphs) {
          if (p.kind === "bullet") continue;
          const parts = p.text.split(/\s*\|\s*/);
          if (parts.length >= 2) {
            roles.push({
              title: parts[0]?.trim() || "Role",
              company: parts[1]?.trim() || "Company",
            });
          } else {
            const atMatch = /^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[-–—]\s*.*)?$/i.exec(p.text);
            if (atMatch) {
              roles.push({
                title: atMatch[1]?.trim() || "Role",
                company: atMatch[2]?.trim() || "Company",
              });
            }
          }
        }
      }
    }
    const mostRecentRole = roles[0] ?? null;
    const roleCount = roles.length;

    const skillSections = structured.sections.filter(
      (s) => s.type === "technical_skills" || s.type === "core_competencies" || /skills|competenc|technolog/i.test(s.heading),
    );
    const skillsList: string[] = [];
    for (const sec of skillSections) {
      if (sec.groups) {
        for (const group of sec.groups) {
          if (group.value) {
            const items = group.value.split(/[,;|•·\n]+/).map((t) => t.trim()).filter(Boolean);
            for (const item of items) {
              if (!skillsList.includes(item)) skillsList.push(item);
            }
          }
        }
      }
      if (sec.paragraphs) {
        for (const p of sec.paragraphs) {
          if (p.text) {
            const items = p.text.split(/[,;|•·\n]+/).map((t) => t.trim()).filter(Boolean);
            for (const item of items) {
              if (!skillsList.includes(item)) skillsList.push(item);
            }
          }
        }
      }
    }
    const fallbackSkills = "parsedData" in resume && (resume as { parsedData?: { skills?: string[] } }).parsedData?.skills
      ? (resume as { parsedData?: { skills?: string[] } }).parsedData!.skills!
      : [];
    if (skillsList.length === 0 && fallbackSkills.length) {
      for (const s of fallbackSkills) {
        if (!skillsList.includes(s)) skillsList.push(s);
      }
    }
    const topSkills = skillsList.slice(0, 8);

    const educationSections = structured.sections.filter(
      (s) => s.type === "education" || /education|academic/i.test(s.heading),
    );
    let highestEducation: { degree: string; institution: string } | null = null;
    for (const sec of educationSections) {
      if (sec.entries && sec.entries.length > 0) {
        for (const entry of sec.entries) {
          if (entry.title?.trim() || entry.company?.trim()) {
            highestEducation = {
              degree: entry.title?.trim() || "Degree / Qualification",
              institution: entry.company?.trim() || "Institution",
            };
            break;
          }
        }
      }
      if (!highestEducation) {
        for (const p of sec.paragraphs) {
          if (p.kind === "bullet") continue;
          const parts = p.text.split(/\s*\|\s*/);
          if (parts.length >= 2) {
            highestEducation = {
              degree: parts[0]?.trim() || "Degree / Qualification",
              institution: parts[1]?.trim() || "Institution",
            };
            break;
          }
        }
      }
      if (highestEducation) break;
    }

    return {
      id: resume._id?.toHexString() ?? null,
      fileName,
      title,
      uploadDate,
      headline,
      mostRecentRole,
      roleCount,
      topSkills,
      highestEducation,
      detectedSections,
    };
  }

  const text = resume.extractedText || "";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headline = lines.length > 1 && lines[1].length < 90 && !/summary|experience|skills|education/i.test(lines[1])
    ? lines[1]
    : null;

  const detectedSections: string[] = [];
  const knownHeadings = ["SUMMARY", "EXPERIENCE", "EMPLOYMENT HISTORY", "EDUCATION", "SKILLS", "TECHNICAL SKILLS", "PROJECTS", "CERTIFICATIONS"];
  for (const line of lines) {
    const upper = line.toUpperCase();
    for (const h of knownHeadings) {
      if ((upper === h || upper.startsWith(h + ":")) && !detectedSections.includes(h)) {
        detectedSections.push(h);
      }
    }
  }

  const textFallbackSkills = "parsedData" in resume && (resume as { parsedData?: { skills?: string[] } }).parsedData?.skills
    ? (resume as { parsedData?: { skills?: string[] } }).parsedData!.skills!
    : [];

  return {
    id: resume._id?.toHexString() ?? null,
    fileName,
    title,
    uploadDate,
    headline,
    mostRecentRole: null,
    roleCount: 0,
    topSkills: textFallbackSkills.slice(0, 8),
    highestEducation: null,
    detectedSections: detectedSections.length > 0 ? detectedSections : ["Resume Content"],
  };
}

export function buildJobSummary(
  job: JobDescriptionDocument | {
    _id?: ObjectId;
    id?: string;
    roleTitle?: string;
    title?: string;
    company?: string | null;
    location?: string | null;
    requiredSkills?: Array<string | { name: string }>;
    createdAt?: Date | string;
  } | null | undefined,
): DeterministicJobSummary | null {
  if (!job) return null;
  const rawSkills = (job.requiredSkills || []) as Array<string | { name: string }>;
  const topSkills = rawSkills
    .map((s) => (typeof s === "string" ? s : s.name))
    .filter(Boolean)
    .slice(0, 8);
  const id = job._id ? job._id.toHexString() : (job as { id?: string }).id ?? null;
  const title = (job as JobDescriptionDocument).roleTitle?.trim() || (job as { title?: string }).title?.trim() || "Job description";
  const dateAdded = job.createdAt ? new Date(job.createdAt).toISOString() : null;

  return {
    id,
    title,
    company: (job as { company?: string | null }).company ?? null,
    location: (job as { location?: string | null }).location ?? null,
    topSkills,
    dateAdded,
  };
}

export function assertCoachCanAccessReview(item: ReviewItemDocument, coachId: string): void {
  if (item.status === "withdrawn") {
    throw new ForbiddenError("This review has been withdrawn");
  }
  const isClaimedByMe = item.assignedCoachId?.toHexString() === coachId;
  const isDecidedByMe = item.decidedBy?.toHexString() === coachId;
  const isPending = item.status === "pending_review";
  const isExpiredClaim = item.status === "in_review" &&
    (!item.claimedAt || item.claimedAt.getTime() <= Date.now() - env.REVIEW_CLAIM_TIMEOUT_MS);

  if (isPending || (item.status === "in_review" && isExpiredClaim)) {
    return;
  }
  if (item.status === "in_review" && isClaimedByMe) {
    return;
  }
  if (["approved", "edited", "rejected"].includes(item.status) && isDecidedByMe) {
    return;
  }

  throw new ForbiddenError("You do not have permission to access this review");
}

export async function getCoachDashboardComprehensive(
  coachId: string,
  options: ReviewQueueOptions = {
    search: "",
    type: "",
    risk: "",
    sort: "oldest",
    page: 1,
    pageSize: 20,
  },
) {
  const baseDashboard = await getCoachDashboard(coachId);
  const queueResult = await listPendingReviews(coachId, options);

  const allPending = await getDb().collection<ReviewItemDocument>("review_items")
    .find({ status: "pending_review" })
    .sort({ createdAt: 1 })
    .toArray();

  const eligiblePending: ReviewItemDocument[] = [];
  for (const item of allPending) {
    if (await hasHumanReviewConsent(item.ownerId)) {
      eligiblePending.push(item);
    }
  }

  eligiblePending.sort((a, b) => {
    const riskDiff = riskRank(b.riskLevel) - riskRank(a.riskLevel);
    if (riskDiff !== 0) return riskDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const nextReviewItem = eligiblePending[0] ?? null;

  let nextReviewData = null;
  if (nextReviewItem) {
    const context = await getReviewContext(nextReviewItem);
    if (context) {
      const waiting = formatWaitingTime(nextReviewItem.createdAt);
      nextReviewData = {
        id: nextReviewItem._id.toHexString(),
        accountName: context.candidate.displayName,
        accountEmail: context.candidate.email,
        jobTitle: context.job?.title ?? null,
        cvName: context.resume?.title || context.resume?.fileName || null,
        reviewType: nextReviewItem.targetType,
        reviewTypeLabel: reviewTypeLabel(nextReviewItem.targetType),
        riskLevel: nextReviewItem.riskLevel,
        flagReason: nextReviewItem.flags[0] ? describeReviewFlag(nextReviewItem.flags[0]) : "Requires coach verification",
        flagReasons: nextReviewItem.flags.map(describeReviewFlag),
        waitingTime: waiting.text,
        waitingSeconds: waiting.seconds,
        createdAt: nextReviewItem.createdAt.toISOString(),
      };
    }
  }

  const queueItems = queueResult.items.map((row) => ({
    id: row.id,
    accountName: row.candidate.displayName,
    accountEmail: row.candidate.email,
    jobTitle: row.jobTitle,
    cvName: row.resumeName,
    reviewType: row.targetType,
    reviewTypeLabel: reviewTypeLabel(row.targetType),
    riskLevel: row.riskLevel,
    flagReason: row.flagReasons[0] || "Requires review",
    flagReasons: row.flagReasons,
    waitingTime: formatWaitingTime(row.createdAt).text,
    waitingSeconds: row.waitingSeconds,
    createdAt: row.createdAt,
    status: row.status,
    assignedCoachId: row.assignedCoachId,
  }));

  const totalPages = Math.ceil(queueResult.total / options.pageSize) || 1;
  const oldestWaitingItem = eligiblePending[0] ?? allPending[0];
  const oldestWaitingMinutes = oldestWaitingItem
    ? Math.floor((Date.now() - oldestWaitingItem.createdAt.getTime()) / 60000)
    : null;

  return {
    ...baseDashboard,
    stats: {
      pending: baseDashboard.pending,
      inReviewByMe: baseDashboard.inReviewByMe,
      completedToday: baseDashboard.completedToday,
      completedThisWeek: baseDashboard.completedThisWeek,
      avgTurnaroundMinutes: baseDashboard.avgTurnaroundMinutes,
      oldestWaitingAt: baseDashboard.oldestWaitingAt,
      oldestWaitingMinutes,
      byRisk: {
        high: baseDashboard.byRisk.high ?? 0,
        medium: baseDashboard.byRisk.medium ?? 0,
        low: baseDashboard.byRisk.low ?? 0,
      },
      byType: {
        job_match: baseDashboard.byType.job_match ?? 0,
        resume_suggestion: baseDashboard.byType.resume_suggestion ?? 0,
        interview_evaluation: baseDashboard.byType.interview_evaluation ?? 0,
      },
    },
    nextReview: nextReviewData,
    queue: {
      items: queueItems,
      total: queueResult.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages,
      nextPage: queueResult.nextPage,
    },
  };
}

export async function getReviewSummary(reviewId: string, coachId: string): Promise<ReviewSummaryResponse> {
  if (!ObjectId.isValid(reviewId)) throw new NotFoundError("Review not found");
  const item = await getDb().collection<ReviewItemDocument>("review_items").findOne({ _id: new ObjectId(reviewId) });
  if (!item) throw new NotFoundError("Review not found");

  assertCoachCanAccessReview(item, coachId);
  await ensureHumanReviewConsent(item.ownerId);

  const context = await getReviewContext(item);
  if (!context) throw new NotFoundError("Review context not found");

  const waiting = formatWaitingTime(item.createdAt);

  return {
    reviewId: item._id.toHexString(),
    status: item.status,
    account: {
      name: context.candidate.displayName,
      email: context.candidate.email,
      registeredDate: context.candidate.registeredAt,
      reviewType: item.targetType,
      reviewTypeLabel: reviewTypeLabel(item.targetType),
      riskLevel: item.riskLevel,
      flagReason: item.flags[0] ? describeReviewFlag(item.flags[0]) : "Requires coach verification",
      flagReasons: item.flags.map(describeReviewFlag),
      waitingTime: waiting.text,
      waitingSeconds: waiting.seconds,
      createdAt: item.createdAt.toISOString(),
    },
    cv: buildDeterministicCvSummary(context.resume),
    job: buildJobSummary(context.job),
  };
}

export async function recordReviewDrawerViewAudit(
  reviewId: string,
  coachId: string,
  view: "cv" | "job_description",
): Promise<void> {
  if (!ObjectId.isValid(reviewId)) throw new NotFoundError("Review not found");
  const item = await getDb().collection<ReviewItemDocument>("review_items").findOne({ _id: new ObjectId(reviewId) });
  if (!item) throw new NotFoundError("Review not found");

  assertCoachCanAccessReview(item, coachId);
  await ensureHumanReviewConsent(item.ownerId);

  await recordAuditEvent({
    actorId: new ObjectId(coachId),
    ownerId: item.ownerId,
    targetId: item._id,
    targetType: view === "cv" ? "cv_drawer" : "job_description_drawer",
    action: view === "cv" ? "coach_view_cv_drawer" : "coach_view_job_description_drawer",
  });
}
