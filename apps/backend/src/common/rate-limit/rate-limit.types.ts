export interface RateWindow {
  count: number;
  resetAt: number;
}

export interface SocketRequest {
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
}
