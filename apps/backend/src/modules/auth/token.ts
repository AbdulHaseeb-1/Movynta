import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { UnauthorizedError } from "../../common/errors/app-error.js";
import type { TokenPayload } from "./auth.types.js";

const TOKEN_PREFIX = "mv1";
const USER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const tokenPayloadSchema = z.object({
  sub: z.string().regex(USER_ID_PATTERN),
  exp: z.number().int().positive(),
});

export function isValidUserId(value: string): boolean {
  return USER_ID_PATTERN.test(value);
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${TOKEN_PREFIX}.${encodedPayload}`).digest("base64url");
}

/** Creates a signed token: `mv1.<base64url(payload)>.<base64url(hmac)>`. */
export function signToken(userId: string, secret: string, ttlSeconds: number, nowMs: number = Date.now()): string {
  if (!isValidUserId(userId)) throw new Error("Invalid user id");
  const payload: TokenPayload = { sub: userId, exp: Math.floor(nowMs / 1000) + ttlSeconds };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${TOKEN_PREFIX}.${encodedPayload}.${sign(encodedPayload, secret)}`;
}

/** Verifies signature (constant time) and expiry. Returns the authenticated user id. */
export function verifyToken(token: string, secret: string, nowMs: number = Date.now()): string {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) throw new UnauthorizedError("Invalid token");
  const [, encodedPayload = "", signature = ""] = parts;

  const expected = Buffer.from(sign(encodedPayload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new UnauthorizedError("Invalid token");
  }

  let payload: TokenPayload;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    payload = tokenPayloadSchema.parse(decoded);
  } catch {
    throw new UnauthorizedError("Invalid token");
  }

  if (payload.exp * 1000 <= nowMs) throw new UnauthorizedError("Token expired");
  return payload.sub;
}
