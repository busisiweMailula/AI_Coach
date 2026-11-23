import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { ConflictError, UnauthorizedError } from "../../common/errors.js";
import { getDb } from "../../infra/db/database.js";
import { signAccessToken } from "../../middleware/auth.js";
import type { UserDocument } from "../users/user.model.js";

export const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.never().optional(),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();

export async function registerCandidate(input: z.infer<typeof registerSchema>) {
  const users = getDb().collection<UserDocument>("users");
  const email = input.email;
  const existing = await users.findOne({ email }, { projection: { _id: 1 } });
  if (existing) throw new ConflictError("A user with this email already exists");

  const now = new Date();
  const user: UserDocument = {
    _id: new ObjectId(),
    email,
    passwordHash: await bcrypt.hash(input.password, 12),
    role: "candidate",
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

  return publicUser(user);
}

export async function login(input: z.infer<typeof loginSchema>) {
  const users = getDb().collection<UserDocument>("users");
  const user = await users.findOne({ email: input.email });

  const validPassword = user
    ? await bcrypt.compare(input.password, user.passwordHash)
    : await bcrypt.compare(input.password, "$2a$12$C6UzMDM.H6dfI/f/IKcEe.5Jx9qR.2IhW7Z6kD3n6QDxgZpE7fK6e");

  if (!user || user.status === "disabled" || !validPassword) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const safeUser = publicUser(user);
  return {
    accessToken: signAccessToken({
      userId: user._id.toHexString(),
      email: user.email,
      role: user.role,
    }),
    user: safeUser,
  };
}

export function publicUser(user: UserDocument) {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
    status: user.status ?? "active",
    createdAt: user.createdAt.toISOString(),
  };
}

