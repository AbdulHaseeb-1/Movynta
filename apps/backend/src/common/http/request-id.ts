import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";

const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

type HeaderRequest = { headers: Record<string, string | string[] | undefined>; requestId?: string };
type HeaderResponse = { setHeader(name: string, value: string): void };

/** Reuses a safe incoming `x-request-id` or generates one, then echoes it back. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: HeaderRequest, res: HeaderResponse, next: () => void): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(incoming) ? undefined : incoming;
    const requestId = candidate !== undefined && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}

/** The part of a request that RequestIdMiddleware fills in. */
export interface RequestWithId {
  readonly requestId?: unknown;
}

export function getRequestId(request: RequestWithId): string {
  const { requestId } = request;
  return typeof requestId === "string" ? requestId : "unknown";
}
