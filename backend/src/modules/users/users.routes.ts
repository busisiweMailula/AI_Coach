import { ObjectId } from "mongodb";
import { Router } from "express";
import { NotFoundError, UnauthorizedError } from "../../common/errors.js";
import { asyncHandler } from "../../common/async-handler.js";
import { authMiddleware } from "../../middleware/auth.js";
import { getDb } from "../../infra/db/database.js";
import { publicUser } from "../auth/auth.service.js";
import type { UserDocument } from "./user.model.js";

export const usersRouter = Router();

usersRouter.get(
  "/me",
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    if (!ObjectId.isValid(req.auth.userId)) throw new NotFoundError("User not found");

    const user = await getDb()
      .collection<UserDocument>("users")
      .findOne({ _id: new ObjectId(req.auth.userId) });
    if (!user) throw new NotFoundError("User not found");

    res.status(200).json({ success: true, data: { user: publicUser(user) } });
  }),
);

