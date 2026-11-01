import type { z } from "zod";
import type { tokenPayloadSchema } from "./token.js";

export interface AuthUser {
  readonly id: string;
}

export type TokenPayload = z.infer<typeof tokenPayloadSchema>;
