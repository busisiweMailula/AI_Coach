import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors.js";
import { asyncHandler } from "../../common/async-handler.js";
import { getDb } from "../../infra/db/database.js";
import { authMiddleware, requireCurrentRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { recordAuditEvent } from "./audit-log.service.js";
import type { AuditLogDocument } from "./audit-log.model.js";
import type { UserDocument, UserRole } from "./user.model.js";
import type { ReviewItemDocument } from "../ai-results/models.js";
import type { ResumeDocument } from "../resumes/resume.model.js";
import type { JobDescriptionDocument } from "../jobs/job-description.model.js";
import type { JobMatchDocument } from "../ai-results/models.js";

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
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const [users, reviews, resumes, jobs, matches, recentAudit] = await Promise.all([
      db.collection<UserDocument>("users").find({}).toArray(),
      db.collection<ReviewItemDocument>("review_items").find({}).toArray(),
      db.collection<ResumeDocument>("resumes").find({}).toArray(),
      db.collection<JobDescriptionDocument>("job_descriptions").find({}).toArray(),
      db.collection<JobMatchDocument>("job_matches").find({}).toArray(),
      db.collection<AuditLogDocument>("audit_logs").find({}).sort({ createdAt: -1 }).limit(10).toArray(),
    ]);
    const now = Date.now();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now - (6 - index) * 24 * 60 * 60 * 1000);
      return date.toISOString().slice(0, 10);
    });
    const registrations = (periodDays: number) => users.filter((user) =>
      user.createdAt.getTime() >= now - periodDays * 24 * 60 * 60 * 1000).length;
    const queue = reviews.filter((item) => item.status === "pending_review" || item.status === "in_review");
    const completedThisWeek = reviews.filter((item) =>
      ["approved", "edited", "rejected"].includes(item.status) &&
      item.decidedAt && item.decidedAt.getTime() >= now - 7 * 24 * 60 * 60 * 1000);
    const turnaround = completedThisWeek.flatMap((item) =>
      item.decidedAt ? [(item.decidedAt.getTime() - item.createdAt.getTime()) / 60_000] : []);
    const oldest = queue.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    const roles = {
      candidate: { total: 0, active: 0, disabled: 0 },
      coach: { total: 0, active: 0, disabled: 0 },
      admin: { total: 0, active: 0, disabled: 0 },
    };
    for (const user of users) {
      const group = roles[user.role];
      group.total += 1;
      if ((user.status ?? "active") === "active") group.active += 1;
      else group.disabled += 1;
    }
    const recentAuditActorIds = recentAudit.flatMap((entry) => entry.actorId ? [entry.actorId] : []);
    const actors = recentAuditActorIds.length
      ? await db.collection<UserDocument>("users").find({ _id: { $in: recentAuditActorIds } }).toArray()
      : [];
    const actorEmails = new Map(actors.map((user) => [user._id.toHexString(), user.email]));
    res.status(200).json({
      success: true,
      data: {
        usersByRole: roles,
        registrations: {
          last7Days: registrations(7),
          last30Days: registrations(30),
          dailyTrend: days.map((day) => ({
            date: day,
            count: users.filter((user) => user.createdAt.toISOString().slice(0, 10) === day).length,
          })),
        },
        reviewQueue: {
          pending: queue.filter((item) => item.status === "pending_review").length,
          inReview: queue.filter((item) => item.status === "in_review").length,
          oldestWaitingAt: oldest?.createdAt.toISOString() ?? null,
          completedThisWeek: completedThisWeek.length,
          averageTurnaroundMinutes: turnaround.length
            ? Math.round(turnaround.reduce((sum, value) => sum + value, 0) / turnaround.length)
            : null,
        },
        contentCounts: { cvs: resumes.length, jobs: jobs.length, matches: matches.length },
        recentAudit: recentAudit.map((entry) => ({
          id: entry._id.toHexString(),
          actorEmail: entry.actorId ? actorEmails.get(entry.actorId.toHexString()) ?? null : null,
          action: entry.action,
          createdAt: entry.createdAt.toISOString(),
        })),
      },
    });
  }),
);

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
      { returnDocument: "after" },
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
    const entries = await getDb().collection<AuditLogDocument>("audit_logs")
      .find({})
      .sort({ createdAt: -1 })
      .limit(250)
      .toArray();
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
