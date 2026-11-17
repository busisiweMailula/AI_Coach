import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../common/errors.js";

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ValidationError("Request validation failed", result.error.flatten()));
    }
    req.body = result.data;
    next();
  };
}

