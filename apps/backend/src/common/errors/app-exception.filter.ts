import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { AppError } from "./app-error.js";
import { getRequestId, type RequestWithId } from "../http/request-id.js";

export interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

/** Converts every thrown error into the structured `{ error: {...} }` body. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpErrors");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<{ status(code: number): { send(body: unknown): void } }>();
    const requestId = getRequestId(request);

    const body = this.toBody(exception, requestId);
    if (body.status >= 500) {
      this.logger.error(`request ${requestId} failed`, exception instanceof Error ? exception.stack : undefined);
    }
    response.status(body.status).send(body.payload);
  }

  private toBody(exception: unknown, requestId: string): { status: number; payload: ErrorResponseBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        payload: {
          error: {
            code: exception.code,
            message: exception.message,
            requestId,
            ...(exception.details ? { details: exception.details } : {}),
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === "string" ? response : extractMessage(response) ?? exception.message;
      return {
        status,
        payload: { error: { code: httpCode(status), message, requestId } },
      };
    }

    return {
      status: 500,
      payload: { error: { code: "internal_error", message: "An unexpected error occurred", requestId } },
    };
  }
}

function extractMessage(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null || !("message" in response)) return undefined;
  const { message } = response;
  if (typeof message === "string") return message;
  if (Array.isArray(message) && message.every((item): item is string => typeof item === "string")) {
    return message.join("; ");
  }
  return undefined;
}

function httpCode(status: number): string {
  if (status === 400) return "bad_request";
  if (status === 413) return "payload_too_large";
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  return status >= 500 ? "internal_error" : "request_error";
}
