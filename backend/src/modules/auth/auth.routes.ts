import { Router } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { validateBody } from "../../middleware/validate.js";
import { ObjectId } from "mongodb";
import { recordAuditEvent } from "../users/audit-log.service.js";
import { login, loginSchema, registerCandidate, registerSchema } from "./auth.service.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const user = await registerCandidate(req.body);
    await recordAuditEvent({
      actorId: null,
      targetId: new ObjectId(user.id),
      action: "candidate_registered",
      requestId: res.locals.requestId,
    });
    res.status(201).json({ success: true, data: { user } });
  }),
);

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    const userId = new ObjectId(result.user.id);
    await recordAuditEvent({
      actorId: userId,
      targetId: userId,
      action: "user_signed_in",
      requestId: res.locals.requestId,
    });
    res.status(200).json({ success: true, data: result });
  }),
);

