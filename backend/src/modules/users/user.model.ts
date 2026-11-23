import type { ObjectId } from "mongodb";

export const USER_ROLES = ["candidate", "coach", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserDocument {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: UserRole;
  status?: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}

