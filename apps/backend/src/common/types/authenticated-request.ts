import type { AuthUser } from "../../modules/auth/auth.types.js";

/** The subset of the incoming request that shared guards and decorators read or write. */
export interface AuthenticatedRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  requestId?: string;
  user?: AuthUser;
}
