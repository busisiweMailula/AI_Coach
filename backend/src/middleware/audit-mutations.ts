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
    const action = auditAction(req.method, requestPath, req.body);
    void recordAuditEvent({
      actorId: new ObjectId(req.auth.userId),
      action,
      requestId: res.locals.requestId,
    }).catch((error: unknown) => {
      logger.error(
        { err: error, requestId: res.locals.requestId, action },
        "Failed to write audit event",
      );
    });
  });

  next();
};

function auditAction(method: string, requestPath: string, body: unknown): string {
  const actionPath = requestPath.replace(/\/[\da-f]{24}(?=\/|$)/gi, "/:id");
  const routeActions: Record<string, string> = {
    "POST /api/v1/resumes/upload": "resume_uploaded",
    "PATCH /api/v1/resumes/:id": "resume_details_updated",
    "POST /api/v1/jobs/analyze": "job_description_submitted",
    "POST /api/v1/matching/analyze": "match_analysis_requested",
    "POST /api/v1/skills/gaps": "skill_gap_analysis_requested",
    "POST /api/v1/resumes/optimize": "resume_suggestions_generated",
    "POST /api/v1/interviews/generate": "interview_questions_generated",
    "POST /api/v1/interviews": "interview_session_started",
    "POST /api/v1/interviews/:id/answer": "interview_answer_submitted",
    "POST /api/v1/interviews/:id/evaluate": "interview_evaluation_requested",
    "POST /api/v1/career/guidance": "career_guidance_requested",
    "POST /api/v1/reviews/request": "coach_review_requested",
    "POST /api/v1/reviews/resume-draft": "coach_cv_review_requested",
  };
  const routeKey = `${method} ${actionPath}`;
  if (routeKey === "POST /api/v1/suggestions/:id/decision") {
    const decision = typeof body === "object" && body !== null && "decision" in body
      ? body.decision
      : undefined;
    return decision === "accept" ? "resume_suggestion_accepted" : "resume_suggestion_rejected";
  }
  if (routeKey === "PUT /api/v1/candidates/me/consents") {
    const granted = typeof body === "object" && body !== null && "granted" in body
      ? body.granted
      : undefined;
    return granted === true ? "privacy_consent_granted" : "privacy_consent_withdrawn";
  }
  return routeActions[routeKey] ?? "application_action_completed";
}
