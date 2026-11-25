import { Router } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { validateBody } from "../../middleware/validate.js";
import { ObjectId } from "mongodb";
import { recordAuditEvent } from "../users/audit-log.service.js";
import { login, loginSchema, registerCandidate, registerSchema } from "./auth.service.js";
import { notifyActiveRole } from "../notifications/notifications.service.js";

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
    await notifyActiveRole({
      role: "admin",
      type: "candidate_registered",
      title: "New candidate registered",
      message: `New candidate registered: ${user.email.split("@")[0]} (${user.email}).`,
      link: "/admin/users",
      entityType: "user",
      entityId: user.id,
      dedupeKey: `candidate-registered:${user.id}`,
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

