import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { UnauthorizedError, ValidationError } from "../../common/errors.js";
import { authMiddleware, requireCurrentRole } from "../../middleware/auth.js";
import { getCoachDashboardComprehensive } from "./reviews.service.js";

export const coachRouter = Router();
coachRouter.use(authMiddleware, requireCurrentRole("coach"));

coachRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const query = z.object({
      search: z.string().trim().max(120).default(""),
      type: z.enum(["job_match", "resume_suggestion", "interview_evaluation"]).or(z.literal("")).default(""),
      risk: z.enum(["low", "medium", "high"]).or(z.literal("")).default(""),
      sort: z.enum(["oldest", "highest_risk"]).default("oldest"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }).strict().safeParse(req.query);

    if (!query.success) {
      throw new ValidationError("Query parameters are invalid", query.error.flatten());
    }

    const data = await getCoachDashboardComprehensive(req.auth.userId, query.data);
    res.status(200).json({ success: true, data });
  }),
);
