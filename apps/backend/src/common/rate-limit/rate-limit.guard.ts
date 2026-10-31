import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/configuration.js";
import { RateLimitedError } from "../errors/app-error.js";

interface RateWindow {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_CLIENTS = 10_000;

interface SocketRequest {
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
}

/**
 * Fixed-window limit per client address, applied to every route. It is a
 * process-local guard against request floods; it does not need an external store.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, RateWindow>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest<SocketRequest>();
    const client = request.socket?.remoteAddress ?? "unknown";
    const now = Date.now();

    const existing = this.windows.get(client);
    const window = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + this.config.rateLimit.windowMs };
    window.count += 1;
    this.windows.set(client, window);

    if (this.windows.size > MAX_TRACKED_CLIENTS) this.prune(now);
    if (window.count > this.config.rateLimit.limit) throw new RateLimitedError();
    return true;
  }

  private prune(now: number): void {
    for (const [client, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(client);
    }
  }
}
