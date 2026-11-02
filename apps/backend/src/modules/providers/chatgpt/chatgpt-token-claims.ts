import { z } from "zod";
import type { ChatgptIdentity } from "./chatgpt.types.js";

const claimsSchema = z.object({
  exp: z.number().optional(),
  email: z.string().optional(),
  "https://api.openai.com/profile": z
    .object({ email: z.string().optional() })
    .optional(),
  "https://api.openai.com/auth": z
    .object({
      chatgpt_account_id: z.string().optional(),
      chatgpt_plan_type: z.string().optional(),
    })
    .optional(),
});

export interface TokenClaims extends ChatgptIdentity {
  accountId: string | undefined;
  /** Epoch milliseconds, from the `exp` claim. */
  expiresAt: number | undefined;
}

/**
 * Reads the claims of a JWT received directly from the issuer over TLS. The signature is not
 * verified because the token is only inspected for display and routing, never trusted for access.
 */
export function readTokenClaims(jwt: string): TokenClaims {
  const empty: TokenClaims = {
    accountId: undefined,
    email: undefined,
    plan: undefined,
    expiresAt: undefined,
  };
  const payload = jwt.split(".")[1];
  if (!payload) return empty;
  try {
    const json: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const claims = claimsSchema.parse(json);
    const auth = claims["https://api.openai.com/auth"];
    return {
      accountId: auth?.chatgpt_account_id,
      email: claims.email ?? claims["https://api.openai.com/profile"]?.email,
      plan: auth?.chatgpt_plan_type,
      expiresAt: claims.exp === undefined ? undefined : claims.exp * 1000,
    };
  } catch {
    return empty;
  }
}
