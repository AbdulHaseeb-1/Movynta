import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UnauthorizedError } from "../../common/errors/app-error.js";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator.js";
import type { AuthenticatedRequest } from "../../common/types/authenticated-request.js";
import { AuthService } from "./auth.service.js";

/** Global guard: every route requires a bearer token unless marked `@Public()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // WebSocket messages are authenticated by the gateway, where the socket state lives.
    if (context.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers["authorization"];
    const value = Array.isArray(header) ? undefined : header;
    const match = value?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
    if (!match?.[1]) throw new UnauthorizedError("Missing bearer token");

    request.user = this.auth.authenticate(match[1]);
    return true;
  }
}
