import { createHash, randomBytes } from "node:crypto";

/** A PKCE verifier and the challenge derived from it, for the sign-in. */
export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** RFC 7636 S256: a random verifier and its SHA-256 challenge. */
export function generatePkce(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Unguessable value that ties a callback to the sign-in that started it. */
export function generateState(): string {
  return randomBytes(24).toString("base64url");
}
