import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors.js";
import { authMiddleware, requireCurrentRole } from "../../middleware/auth.js";
import { markAllNotificationsRead, markNotificationRead, listNotifications, unreadNotificationCount } from "./notifications.service.js";

export const notificationsRouter = Router();
notificationsRouter.use(authMiddleware, requireCurrentRole("candidate", "coach", "admin"));

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const parsed = z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().regex(/^\d+$/).optional(),
      unreadOnly: z.enum(["true", "false"]).default("false"),
    }).strict().safeParse(req.query);
    if (!parsed.success) throw new ValidationError("Notification query is invalid", parsed.error.flatten());
    const result = await listNotifications(req.auth.userId, {
      limit: parsed.data.limit,
      offset: Number(parsed.data.cursor ?? "0"),
      unreadOnly: parsed.data.unreadOnly === "true",
    });
    res.status(200).json({ success: true, data: result });
  }),
);

notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    res.status(200).json({
      success: true,
      data: { count: await unreadNotificationCount(req.auth.userId) },
    });
  }),
);

notificationsRouter.patch(
  "/:notificationId/read",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const notification = await markNotificationRead(req.params.notificationId, req.auth.userId);
    if (!notification) throw new NotFoundError("Notification not found");
    res.status(200).json({ success: true, data: notification });
  }),
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const modifiedCount = await markAllNotificationsRead(req.auth.userId);
    res.status(200).json({ success: true, data: { modifiedCount } });
  }),
);
