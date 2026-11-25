import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../../common/errors.js";
import { authMiddleware, requireCurrentRole, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  claimReview,
  decideReview,
  getCandidateReviewDetails,
  getCoachDashboard,
  getCoachReviewDetails,
  getReviewResumeFile,
  getReviewItem,
  getReviewSummary,
  listPendingReviews,
  listCandidateReviews,
  recordReviewDrawerViewAudit,
  requestReview,
  releaseReview,
  toReviewResponse,
} from "./reviews.service.js";

const requestSchema = z.object({
  targetType: z.enum(["job_match", "resume_suggestion", "interview_evaluation"]),
  targetId: z.string().regex(/^[\da-f]{24}$/i),
  reason: z.string().trim().min(1).max(2000),
}).strict();

export const reviewsRouter = Router();
reviewsRouter.use(authMiddleware);

reviewsRouter.post(
  "/request",
  requireCurrentRole("candidate"),
  validateBody(requestSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const item = await requestReview({ ...req.body, ownerId: req.auth.userId });
    res.status(201).json({ success: true, data: toReviewResponse(item) });
  }),
);

reviewsRouter.get(
  "/pending",
  requireCurrentRole("coach"),
  asyncHandler(async (req, res) => {
    const query = z.object({
      search: z.string().trim().max(120).default(""),
      type: z.enum(["job_match", "resume_suggestion", "interview_evaluation"]).or(z.literal("")).default(""),
      risk: z.enum(["low", "medium", "high"]).or(z.literal("")).default(""),
      sort: z.enum(["oldest", "highest_risk"]).default("oldest"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }).strict().safeParse(req.query);
    if (!query.success) throw new ValidationError("Review queue query is invalid", query.error.flatten());
    if (!req.auth) throw new UnauthorizedError();
    const result = await listPendingReviews(req.auth.userId, query.data);
    res.status(200).json({ success: true, data: result });
  }),
);

reviewsRouter.get(
  "/dashboard",
  requireCurrentRole("coach"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    res.status(200).json({ success: true, data: await getCoachDashboard(req.auth.userId) });
  }),
);

reviewsRouter.get(
  "/feedback",
  requireCurrentRole("candidate"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    res.status(200).json({ success: true, data: { items: await listCandidateReviews(req.auth.userId) } });
  }),
);

reviewsRouter.get(
  "/feedback/:reviewId",
  requireCurrentRole("candidate"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    res.status(200).json({
      success: true,
      data: await getCandidateReviewDetails(req.params.reviewId, req.auth.userId),
    });
  }),
);

reviewsRouter.get(
  "/:reviewId/resume-file",
  requireCurrentRole("coach"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const file = await getReviewResumeFile(req.params.reviewId, req.auth.userId);
    res.status(200)
      .type(file.contentType)
      .setHeader("Content-Disposition", `inline; filename="${safeFileName(file.fileName)}"`)
      .send(file.buffer);
  }),
);

reviewsRouter.post(
  "/:reviewId/claim",
  requireCurrentRole("coach"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const item = await claimReview(req.params.reviewId, req.auth.userId);
    res.status(200).json({ success: true, data: toReviewResponse(item) });
  }),
);

reviewsRouter.post(
  "/:reviewId/release",
  requireCurrentRole("coach", "admin"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    if (req.auth.role !== "coach" && req.auth.role !== "admin") throw new ForbiddenError();
    const item = await releaseReview(req.params.reviewId, req.auth.userId, req.auth.role);
    res.status(200).json({ success: true, data: toReviewResponse(item) });
  }),
);

reviewsRouter.get(
  "/:reviewId/summary",
  requireCurrentRole("coach"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const summary = await getReviewSummary(req.params.reviewId, req.auth.userId);
    res.status(200).json({ success: true, data: summary });
  }),
);

reviewsRouter.post(
  "/:reviewId/audit-view",
  requireCurrentRole("coach"),
  validateBody(z.object({ view: z.enum(["cv", "job_description"]) }).strict()),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    await recordReviewDrawerViewAudit(req.params.reviewId, req.auth.userId, req.body.view);
    res.status(200).json({ success: true });
  }),
);

reviewsRouter.get(
  "/:reviewId",
  requireCurrentRole("coach", "candidate"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    if (req.auth.role === "coach") {
      const viewQuery = req.query.view === "cv" || req.query.view === "job_description" ? req.query.view : undefined;
      const details = await getCoachReviewDetails(req.params.reviewId, req.auth.userId, { view: viewQuery });
      res.status(200).json({ success: true, data: details });
      return;
    }
    const item = await getReviewItem(req.params.reviewId, req.auth.userId, req.auth.role);
    res.status(200).json({ success: true, data: toReviewResponse(item) });
  }),
);

reviewsRouter.post(
  "/:reviewId/decision",
  requireCurrentRole("coach"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const item = await decideReview({
      reviewId: req.params.reviewId,
      coachId: req.auth.userId,
      body: req.body,
    });
    res.status(200).json({ success: true, data: toReviewResponse(item) });
  }),
);

function safeFileName(value: string): string {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "resume";
}
