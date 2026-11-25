import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors.js";
import { asyncHandler } from "../../common/async-handler.js";
import { getDb } from "../../infra/db/database.js";
import { authMiddleware, requireCurrentRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { listAuditEvents, recordAuditEvent } from "./audit-log.service.js";
import type { UserDocument, UserRole } from "./user.model.js";

const statusSchema = z.object({
  status: z.enum(["active", "disabled"]),
}).strict();
const coachRegistrationSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();

export const adminRouter = Router();
adminRouter.use(authMiddleware, requireCurrentRole("admin"));

adminRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await getDb().collection<UserDocument>("users")
      .find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    res.status(200).json({ success: true, data: { users: users.map(toAdminUser) } });
  }),
);

adminRouter.post(
  "/users",
  validateBody(coachRegistrationSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const users = getDb().collection<UserDocument>("users");
    if (await users.findOne({ email: req.body.email }, { projection: { _id: 1 } })) {
      throw new ConflictError("A user with this email already exists");
    }

    const now = new Date();
    const user: UserDocument = {
      _id: new ObjectId(),
      email: req.body.email,
      passwordHash: await bcrypt.hash(req.body.password, 12),
      role: "coach",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    try {
      await users.insertOne(user);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === 11000) {
        throw new ConflictError("A user with this email already exists");
      }
      throw error;
    }
    await recordAuditEvent({
      actorId: new ObjectId(req.auth.userId),
      targetId: user._id,
      action: "coach_account_registered",
      requestId: res.locals.requestId,
    });
    res.status(201).json({ success: true, data: { user: toAdminUser(user) } });
  }),
);

adminRouter.patch(
  "/users/:userId/status",
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth || !ObjectId.isValid(req.params.userId)) throw new NotFoundError("User not found");
    const targetId = new ObjectId(req.params.userId);
    const users = getDb().collection<UserDocument>("users");
    const current = await users.findOne({ _id: targetId });
    if (!current) throw new NotFoundError("User not found");
    if (current.role === "admin") {
      throw new ConflictError("Admin accounts are managed through controlled provisioning");
    }
    const currentStatus = current.status ?? "active";
    if (currentStatus === req.body.status) {
      res.status(200).json({ success: true, data: { user: toAdminUser(current) } });
      return;
    }

    const updated = await users.findOneAndUpdate(
      {
        _id: targetId,
        role: current.role,
        ...(current.status ? { status: current.status } : { status: { $exists: false } }),
      },
      { $set: { status: req.body.status, updatedAt: new Date() } },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!updated) throw new ConflictError("The account status changed; reload the account list");

    await recordAuditEvent({
      actorId: new ObjectId(req.auth.userId),
      targetId,
      action: "user_account_status_changed",
      previousStatus: currentStatus,
      newStatus: updated.status,
      requestId: res.locals.requestId,
    });

    res.status(200).json({ success: true, data: { user: toAdminUser(updated) } });
  }),
);

adminRouter.get(
  "/audit-logs",
  asyncHandler(async (_req, res) => {
    const entries = await listAuditEvents(250);
    const userIds = [...new Set(entries.flatMap((entry) => [
      entry.actorId?.toHexString(),
      (entry.ownerId ?? entry.targetId)?.toHexString(),
    ].filter((id): id is string => Boolean(id))))].map((id) => new ObjectId(id));
    const users = userIds.length > 0
      ? await getDb().collection<UserDocument>("users").find({ _id: { $in: userIds } }).toArray()
      : [];
    const emails = new Map(users.map((user) => [user._id.toHexString(), user.email]));

    res.status(200).json({
      success: true,
      data: {
        items: entries.map((entry) => {
          const subjectId = entry.ownerId ?? entry.targetId ?? null;
          return {
            id: entry._id.toHexString(),
            actorEmail: entry.actorId ? emails.get(entry.actorId.toHexString()) ?? null : null,
            subjectEmail: subjectId ? emails.get(subjectId.toHexString()) ?? null : null,
            action: entry.action,
            targetType: entry.targetType ?? null,
            previousRole: entry.previousRole ?? null,
            newRole: entry.newRole ?? null,
            previousStatus: entry.previousStatus ?? null,
            newStatus: entry.newStatus ?? null,
            createdAt: entry.createdAt.toISOString(),
            requestId: entry.requestId ?? null,
          };
        }),
      },
    });
  }),
);

function toAdminUser(user: UserDocument): {
  id: string;
  email: string;
  role: UserRole;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
    status: user.status ?? "active",
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
