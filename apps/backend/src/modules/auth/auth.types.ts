import type { z } from "zod";
import type { tokenPayloadSchema } from "./token.js";

/** The signed-in user that a request is made for. */
export interface AuthUser {
  readonly id: string;
}

/** The contents of a bearer token. */
export type TokenPayload = z.infer<typeof tokenPayloadSchema>;
