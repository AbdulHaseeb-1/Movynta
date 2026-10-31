/**
 * Domain errors carry a stable machine-readable `code` and the HTTP status the
 * exception filter should return. Messages must never include secrets or
 * sensitive tool arguments.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "not_found";
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "forbidden";
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = "unauthorized";
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "conflict";
}

export class ValidationFailedError extends AppError {
  readonly status = 422;
  readonly code = "validation_failed";
}

export class ServiceUnavailableError extends AppError {
  readonly status = 503;
  readonly code = "service_unavailable";
}

export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = "rate_limited";

  constructor() {
    super("Too many requests, slow down and try again shortly");
  }
}
