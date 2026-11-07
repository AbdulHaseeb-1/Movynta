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

/** The resource does not exist, or the caller may not see it. Responds 404. */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "not_found";
}

/** The caller is signed in but may not do this. Responds 403. */
export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "forbidden";
}

/** The request has no valid credentials. Responds 401. */
export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = "unauthorized";
}

/** The request conflicts with the current state, such as a stale revision or a run that already ended. Responds 409. */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "conflict";
}

/** The request is well formed but its content is refused, such as an unknown id or a value out of range. Responds 422. */
export class ValidationFailedError extends AppError {
  readonly status = 422;
  readonly code = "validation_failed";
}

/** A service the request needs, such as the editor or a model provider, is not available. Responds 503. */
export class ServiceUnavailableError extends AppError {
  readonly status = 503;
  readonly code = "service_unavailable";
}

/** The caller sent too many requests. Responds 429. */
export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = "rate_limited";

  constructor() {
    super("Too many requests, slow down and try again shortly");
  }
}
