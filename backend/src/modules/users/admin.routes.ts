import { ObjectId } from "mongodb";
import { Router } from "express";
import { z } from "zod";
import { ConflictError, NotFoundError } from "../../common/errors.js";
import { asyncHandler } from "../../common/async-handler.js";
import { getDb } from "../../infra/db/database.js";
import { authMiddleware, requireCurrentRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import type { UserDocument, UserRole } from "./user.model.js";

const roleSchema = z.object({
  role: z.enum(["candidate", "coach"]),
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

adminRouter.patch(
  "/users/:userId/role",
  validateBody(roleSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth || !ObjectId.isValid(req.params.userId)) throw new NotFoundError("User not found");
    const targetId = new ObjectId(req.params.userId);
    const users = getDb().collection<UserDocument>("users");
    const current = await users.findOne({ _id: targetId });
    if (!current) throw new NotFoundError("User not found");
    if (current.role === "admin") {
      throw new ConflictError("Admin accounts are managed through controlled provisioning");
    }
    if (current.role === req.body.role) {
      res.status(200).json({ success: true, data: { user: toAdminUser(current) } });
      return;
    }

    const updated = await users.findOneAndUpdate(
      { _id: targetId, role: current.role },
      { $set: { role: req.body.role, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!updated) throw new ConflictError("The user's role changed; reload the account list");

    await getDb().collection("audit_logs").insertOne({
      _id: new ObjectId(),
      actorId: new ObjectId(req.auth.userId),
      targetId,
      action: "user_role_changed",
      previousRole: current.role,
      newRole: updated.role,
      requestId: res.locals.requestId,
      createdAt: new Date(),
    });

    res.status(200).json({ success: true, data: { user: toAdminUser(updated) } });
  }),
);

function toAdminUser(user: UserDocument): {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
