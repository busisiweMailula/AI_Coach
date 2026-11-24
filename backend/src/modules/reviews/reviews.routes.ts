import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { NotFoundError, UnauthorizedError } from "../../common/errors.js";
import { authMiddleware, requireCurrentRole, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  decideReview,
  getCoachReviewDetails,
  getReviewItem,
  listMyReviews,
  listPendingReviews,
  requestReview,
  requestResumeDraftReview,
  toReviewResponse,
} from "./reviews.service.js";

const requestSchema = z.object({
  targetType: z.enum(["job_match", "resume_suggestion", "interview_evaluation"]),
  targetId: z.string().regex(/^[\da-f]{24}$/i),
  reason: z.string().trim().min(1).max(2000),
}).strict();
const resumeDraftRequestSchema = z.object({
  resumeId: z.string().regex(/^[\da-f]{24}$/i),
  jobDescriptionId: z.string().regex(/^[\da-f]{24}$/i),
  draftContent: z.string().trim().min(1).max(200_000),
  reason: z.string().trim().min(1).max(2000),
}).strict();

export const reviewsRouter = Router();
reviewsRouter.use(authMiddleware);

reviewsRouter.get(
  "/mine",
  requireCurrentRole("candidate"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const items = await listMyReviews(req.auth.userId);
    res.status(200).json({
      success: true,
      data: { items: items.map(toReviewResponse) },
    });
  }),
);

reviewsRouter.post(
  "/resume-draft",
  requireCurrentRole("candidate"),
  validateBody(resumeDraftRequestSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const item = await requestResumeDraftReview({ ...req.body, ownerId: req.auth.userId });
    res.status(201).json({ success: true, data: toReviewResponse(item) });
  }),
);

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
  asyncHandler(async (_req, res) => {
    const items = await listPendingReviews();
    res.status(200).json({ success: true, data: { items: items.map(toReviewResponse), nextCursor: null } });
  }),
);

reviewsRouter.get(
  "/:reviewId",
  requireCurrentRole("candidate", "coach"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    if (req.auth.role === "coach") {
      const details = await getCoachReviewDetails(req.params.reviewId, req.auth.userId);
      res.status(200).json({ success: true, data: details });
      return;
    }
    const item = await getReviewItem(req.params.reviewId, req.auth.userId, req.auth.role);
    if (item.targetType === "resume_draft") {
      if (!item.targetContent) throw new NotFoundError("Submitted CV draft not found");
      res.status(200).json({
        success: true,
        data: {
          review: toReviewResponse(item),
          target: { type: "resume_draft", content: item.targetContent },
        },
      });
      return;
    }
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
