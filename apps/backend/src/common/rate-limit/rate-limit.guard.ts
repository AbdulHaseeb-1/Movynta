import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import { RateLimitedError } from "../errors/app-error.js";
import type { RateWindow, SocketRequest } from "./rate-limit.types.js";

const MAX_TRACKED_CLIENTS = 10_000;

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
    const window =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + this.config.rateLimit.windowMs };
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
