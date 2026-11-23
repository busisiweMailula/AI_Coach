import type { RequestHandler } from "express";
import { logger } from "../config/logger.js";
import { recordAuditEvent } from "../modules/users/audit-log.service.js";
import { ObjectId } from "mongodb";

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const auditSuccessfulMutations: RequestHandler = (req, res, next) => {
  if (!mutatingMethods.has(req.method)) {
    next();
    return;
  }

  const requestPath = req.path;
  const hasDedicatedAudit = requestPath === "/api/v1/auth/register" ||
    requestPath === "/api/v1/auth/login" ||
    (req.method === "POST" && requestPath === "/api/v1/admin/users") ||
    (requestPath.startsWith("/api/v1/admin/users/") && requestPath.endsWith("/status")) ||
    (requestPath.startsWith("/api/v1/reviews/") && requestPath.endsWith("/decision"));

  res.once("finish", () => {
    if (hasDedicatedAudit || res.statusCode < 200 || res.statusCode >= 300 || !req.auth) return;
    const actionPath = requestPath.replace(/\/[\da-f]{24}(?=\/|$)/gi, "/:id");
    void recordAuditEvent({
      actorId: new ObjectId(req.auth.userId),
      action: `${req.method} ${actionPath}`,
      requestId: res.locals.requestId,
    }).catch((error: unknown) => {
      logger.error(
        { err: error, requestId: res.locals.requestId, action: `${req.method} ${actionPath}` },
        "Failed to write audit event",
      );
    });
  });

  next();
};
