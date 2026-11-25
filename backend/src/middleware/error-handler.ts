import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { MongoServerError } from "mongodb";
import { AppError } from "../common/errors.js";
import { logger } from "../config/logger.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, requestId: res.locals.requestId }, error.message);
    } else {
      logger.warn({ code: error.code, requestId: res.locals.requestId }, error.message);
    }
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      requestId: res.locals.requestId,
    });
    return;
  }

  if (error instanceof MongoServerError && error.code === 11000) {
    res.status(409).json({
      success: false,
      error: { code: "CONFLICT", message: "A user with this email already exists" },
      requestId: res.locals.requestId,
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    const statusCode = tooLarge ? 413 : 400;
    const code = tooLarge ? "UPLOAD_TOO_LARGE" : "INVALID_MULTIPART_REQUEST";
    const message = tooLarge
      ? "Uploaded file exceeds the configured size limit"
      : "Invalid multipart upload";
    logger.warn({ code, requestId: res.locals.requestId }, message);
    res.status(statusCode).json({
      success: false,
      error: { code, message },
      requestId: res.locals.requestId,
    });
    return;
  }

  const status = (error as { status?: number }).status;
  if (status === 400) {
    res.status(400).json({
      success: false,
      error: { code: "BAD_REQUEST", message: "Invalid request body" },
      requestId: res.locals.requestId,
    });
    return;
  }

  logger.error({ err: error, requestId: res.locals.requestId, path: req.path }, "Unhandled request error");
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    requestId: res.locals.requestId,
  });
};

