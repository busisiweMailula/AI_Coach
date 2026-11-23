import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.js";
import { apiRateLimiter } from "./middleware/rate-limit.js";
import { auditSuccessfulMutations } from "./middleware/audit-mutations.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { env } from "./config/env.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { adminRouter } from "./modules/users/admin.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { interviewsRouter } from "./modules/interviews/interviews.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { privacyRouter } from "./modules/privacy/privacy.routes.js";
import { resumesRouter } from "./modules/resumes/resumes.routes.js";
import { reviewsRouter } from "./modules/reviews/reviews.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { workflowsRouter } from "./modules/workflows/workflows.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use(auditSuccessfulMutations);
  app.use(apiRateLimiter);

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/candidates/me", privacyRouter);
  app.use("/api/v1/resumes", resumesRouter);
  app.use("/api/v1/jobs", jobsRouter);
  app.use("/api/v1", workflowsRouter);
  app.use("/api/v1", interviewsRouter);
  app.use("/api/v1/reviews", reviewsRouter);

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
      requestId: res.locals.requestId,
    });
  });
  app.use(errorHandler);

  return app;
}

