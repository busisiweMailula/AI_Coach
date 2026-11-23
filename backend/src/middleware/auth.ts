import type { RequestHandler } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { env } from "../config/env.js";
import { ForbiddenError, UnauthorizedError } from "../common/errors.js";
import { getDb } from "../infra/db/database.js";
import type { UserDocument, UserRole } from "../modules/users/user.model.js";

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
}

const jwtClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["candidate", "coach", "admin"]),
});

export function signAccessToken(user: AuthContext): string {
  return jwt.sign(
    { email: user.email, role: user.role },
    env.JWT_SECRET,
    {
      subject: user.userId,
      issuer: "ai-resume-interview-coach",
      audience: "ai-resume-interview-coach-api",
      expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
      algorithm: "HS256",
    },
  );
}

export const authMiddleware: RequestHandler = (req, _res, next) => {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) return next(new UnauthorizedError("Missing or invalid bearer token"));

  let auth: AuthContext;
  try {
    const payload = jwt.verify(match[1], env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "ai-resume-interview-coach",
      audience: "ai-resume-interview-coach-api",
    });
    const claims = jwtClaimsSchema.safeParse(payload);
    if (!claims.success) {
      return next(new UnauthorizedError("Invalid or expired token"));
    }

    auth = {
      userId: claims.data.sub,
      email: claims.data.email,
      role: claims.data.role,
    };
  } catch {
    return next(new UnauthorizedError("Invalid or expired token"));
  }

  if (!ObjectId.isValid(auth.userId)) {
    req.auth = auth;
    return next();
  }

  void getDb().collection<UserDocument>("users")
    .findOne({ _id: new ObjectId(auth.userId) }, { projection: { status: 1 } })
    .then((user) => {
      if (user?.status === "disabled") {
        next(new UnauthorizedError("This account has been deactivated"));
        return;
      }
      req.auth = auth;
      next();
    }, next);
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!roles.includes(req.auth.role)) {
      return next(new ForbiddenError("Insufficient role permissions"));
    }
    next();
  };
}

export function requireCurrentRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!roles.includes(req.auth.role) || !ObjectId.isValid(req.auth.userId)) {
      return next(new ForbiddenError("Insufficient role permissions"));
    }

    void getDb().collection<UserDocument>("users")
      .findOne({ _id: new ObjectId(req.auth.userId) })
      .then((user) => {
        if (!user || user.role !== req.auth?.role || !roles.includes(user.role)) {
          next(new ForbiddenError("Your account role changed. Sign in again."));
          return;
        }
        next();
      }, next);
  };
}

