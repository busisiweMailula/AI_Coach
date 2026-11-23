import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "../../infra/db/database.js";
import type { UserDocument } from "./user.model.js";

const demoAdminSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();

export async function bootstrapDemoAdmin(input: {
  nodeEnv: string;
  email: string | undefined;
  password: string | undefined;
}): Promise<"created" | "already_exists"> {
  if (input.nodeEnv !== "development") {
    throw new Error("Demo admin bootstrap is only available in development");
  }

  const parsed = demoAdminSchema.safeParse({ email: input.email, password: input.password });
  if (!parsed.success) {
    throw new Error("Set a valid DEMO_ADMIN_EMAIL and a DEMO_ADMIN_PASSWORD of 12 to 128 characters");
  }

  const users = getDb().collection<UserDocument>("users");
  const existing = await users.findOne({ email: parsed.data.email });
  if (existing) {
    if (existing.role !== "admin") {
      throw new Error("The demo admin email is already used by a non-admin account");
    }
    return "already_exists";
  }

  const now = new Date();
  await users.insertOne({
    _id: new ObjectId(),
    email: parsed.data.email,
    passwordHash: await bcrypt.hash(parsed.data.password, 12),
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return "created";
}
