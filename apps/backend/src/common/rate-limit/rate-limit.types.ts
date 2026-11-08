/** A caller's request count within the current rate-limit window. */
export interface RateWindow {
  count: number;
  resetAt: number;
}

/** The request fields the WebSocket rate limit reads from a connection. */
export interface SocketRequest {
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
}
