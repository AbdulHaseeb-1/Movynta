/** The part of an HTTP request that the request-id and rate-limit code read and write. */
export type HeaderRequest = { headers: Record<string, string | string[] | undefined>; requestId?: string };
/** The part of an HTTP response that the request-id code writes headers to. */
export type HeaderResponse = { setHeader(name: string, value: string): void };

/** The part of a request that RequestIdMiddleware fills in. */
export interface RequestWithId {
  readonly requestId?: unknown;
}
