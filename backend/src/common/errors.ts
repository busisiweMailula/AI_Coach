export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(message, 409, "CONFLICT");
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "The requested service is not configured") {
    super(message, 503, "SERVICE_UNAVAILABLE");
  }
}

export class UpstreamServiceError extends AppError {
  constructor(message = "AI service could not complete the request") {
    super(message, 502, "AI_SERVICE_ERROR");
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Uploaded file exceeds the configured size limit") {
    super(message, 413, "UPLOAD_TOO_LARGE");
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = "Unsupported or invalid file type") {
    super(message, 415, "UNSUPPORTED_MEDIA_TYPE");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

