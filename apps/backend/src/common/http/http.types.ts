export type HeaderRequest = { headers: Record<string, string | string[] | undefined>; requestId?: string };
export type HeaderResponse = { setHeader(name: string, value: string): void };

/** The part of a request that RequestIdMiddleware fills in. */
export interface RequestWithId {
  readonly requestId?: unknown;
}
