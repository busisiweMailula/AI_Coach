import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../common/async-handler.js";
import { UnauthorizedError, ValidationError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import {
  getOwnedAsyncJob,
  getOwnedJobDescription,
  listOwnedJobDescriptions,
  submitJobDescription,
} from "./jobs.service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 0 },
});

export const jobsRouter = Router();
jobsRouter.use(authMiddleware, requireRole("candidate"));

jobsRouter.post(
  "/analyze",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    if (req.file && req.body.text !== undefined) {
      throw new ValidationError("Provide either job description text or one file");
    }
    const accepted = await submitJobDescription({
      ownerId: req.auth.userId,
      text: req.file ? undefined : req.body.text,
      file: req.file
        ? {
            originalName: req.file.originalname,
            declaredMimeType: req.file.mimetype,
            buffer: req.file.buffer,
          }
        : undefined,
    });
    res.status(202).json({
      success: true,
      data: {
        jobId: accepted.job._id.toHexString(),
        status: accepted.job.status,
        statusUrl: `/api/v1/jobs/status/${accepted.job._id.toHexString()}`,
        jobDescriptionId: accepted.description._id.toHexString(),
      },
    });
  }),
);

jobsRouter.get(
  "/status/:jobId",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const job = await getOwnedAsyncJob(req.params.jobId, req.auth.userId);
    res.status(200).json({
      success: true,
      data: {
        jobId: job._id.toHexString(),
        type: job.type,
        status: job.status,
        progress: job.progress,
        resultType: job.resultType,
        resultId: job.resultId?.toHexString() ?? null,
        error: job.safeErrorCode
          ? { code: job.safeErrorCode, message: "The job could not be completed" }
          : null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
    });
  }),
);

jobsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const jobs = await listOwnedJobDescriptions(req.auth.userId);
    res.status(200).json({
      success: true,
      data: {
        items: jobs.map((job) => toJobDescriptionResponse(job, false)),
        nextCursor: null,
      },
    });
  }),
);

jobsRouter.get(
  "/:jobDescriptionId",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const job = await getOwnedJobDescription(req.params.jobDescriptionId, req.auth.userId);
    res.status(200).json({ success: true, data: toJobDescriptionResponse(job, true) });
  }),
);

function toJobDescriptionResponse(
  job: Awaited<ReturnType<typeof getOwnedJobDescription>>,
  includeText: boolean,
) {
  return {
    id: job._id.toHexString(),
    sourceType: job.sourceType,
    analysisStatus: job.analysisStatus,
    createdAt: job.createdAt.toISOString(),
    ...(job.roleTitle !== undefined ? { roleTitle: job.roleTitle } : {}),
    ...(job.requiredSkills !== undefined ? { requiredSkills: job.requiredSkills } : {}),
    ...(job.preferredSkills !== undefined ? { preferredSkills: job.preferredSkills } : {}),
    ...(job.responsibilities !== undefined ? { responsibilities: job.responsibilities } : {}),
    ...(job.analyzerVersion !== undefined ? { analyzerVersion: job.analyzerVersion } : {}),
    ...(includeText ? { text: job.rawText } : {}),
  };
}

