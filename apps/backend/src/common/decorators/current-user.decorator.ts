import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import type { AuthUser } from "../../modules/auth/auth.types.js";
import { UnauthorizedError } from "../errors/app-error.js";

/** Injects the authenticated user set by `AuthGuard`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new UnauthorizedError("Missing authenticated user");
  return user;
});
