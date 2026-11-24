import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { UnauthorizedError, ValidationError } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { ensureResumeConsent } from "../privacy/privacy.service.js";
import {
  getParsedResumeData,
  getResume,
  getResumes,
  getStructuredCv,
  patchResume,
  saveStructuredCv,
  uploadResume,
} from "./resumes.service.js";
import { structuredCvSchema } from "./structured-cv.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 0 },
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const resumesRouter = Router();
resumesRouter.use(authMiddleware, requireRole("candidate"));

resumesRouter.post(
  "/upload",
  asyncHandler(async (req, _res, next) => {
    if (!req.auth) throw new UnauthorizedError();
    await ensureResumeConsent(req.auth.userId);
    next();
  }),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new ValidationError("A resume file is required");
    if (!req.auth) throw new UnauthorizedError();

    const resume = await uploadResume({
      ownerId: req.auth.userId,
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
      buffer: file.buffer,
    });

    res.status(201).json({ success: true, data: { resume: toResumeResponse(resume, true) } });
  }),
);

resumesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const resumes = await getResumes(req.auth.userId);
    res.status(200).json({
      success: true,
      data: { items: resumes.map((resume) => toResumeResponse(resume, false)) },
    });
  }),
);

resumesRouter.get(
  "/:resumeId",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const resume = await getResume(req.params.resumeId, req.auth.userId);
    const parsedData = await getParsedResumeData(resume, req.auth.userId);
    res.status(200).json({ success: true, data: { resume: toResumeResponse(resume, true, parsedData) } });
  }),
);

resumesRouter.get(
  "/:resumeId/structured",
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const resume = await getResume(req.params.resumeId, req.auth.userId);
    const structuredCv = await getStructuredCv(resume);
    res.status(200).json({ success: true, data: { resumeId: resume._id.toHexString(), structuredCv } });
  }),
);

resumesRouter.put(
  "/:resumeId/structured",
  validateBody(z.object({ structuredCv: structuredCvSchema }).strict()),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const structuredCv = await saveStructuredCv(req.params.resumeId, req.auth.userId, req.body.structuredCv);
    res.status(200).json({ success: true, data: { structuredCv } });
  }),
);

resumesRouter.patch(
  "/:resumeId",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const resume = await patchResume(req.params.resumeId, req.auth.userId, req.body);
    res.status(200).json({ success: true, data: { resume: toResumeResponse(resume, true) } });
  }),
);

export function toResumeResponse(
  resume: Awaited<ReturnType<typeof uploadResume>>,
  includeText: boolean,
  parsedData?: unknown,
) {
  return {
    id: resume._id.toHexString(),
    originalFileName: resume.originalFileName,
    contentType: resume.contentType,
    sizeBytes: resume.sizeBytes,
    textExtractionStatus: resume.textExtractionStatus,
    parseStatus: resume.parseStatus,
    ...(resume.parseJobId ? { parseJobId: resume.parseJobId.toHexString() } : {}),
    ...(resume.title === undefined ? {} : { title: resume.title }),
    ...(resume.notes === undefined ? {} : { notes: resume.notes }),
    ...(includeText ? { extractedText: resume.extractedText } : {}),
    ...(resume.structuredCv ? { structuredCv: resume.structuredCv } : {}),
    ...(parsedData ? { parsedData } : {}),
    createdAt: resume.createdAt.toISOString(),
    updatedAt: resume.updatedAt.toISOString(),
  };
}

