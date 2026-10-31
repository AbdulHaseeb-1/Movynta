import { isValidUserId, signToken } from "../modules/auth/token.js";

const DEFAULT_TOKEN_TTL_SECONDS = 8 * 60 * 60;

/**
 * Issues a bearer token for a user id. Used by the trusted local client during
 * development; the secret stays in the server environment.
 *
 * Usage: AUTH_SECRET=... node dist/cli/issue-token.js <user-id>
 */
function main(): void {
  const userId = process.argv[2];
  if (userId === undefined || !isValidUserId(userId)) {
    process.stderr.write("Usage: issue-token <user-id> (letters, digits, '.', ':', '_' or '-')\n");
    process.exit(1);
  }

  const secret = process.env["AUTH_SECRET"];
  if (secret === undefined || secret.length < 32) {
    process.stderr.write("AUTH_SECRET must be set to at least 32 characters\n");
    process.exit(1);
  }

  const ttl = Number(process.env["AUTH_TOKEN_TTL_SECONDS"] ?? DEFAULT_TOKEN_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    process.stderr.write("AUTH_TOKEN_TTL_SECONDS must be a positive integer\n");
    process.exit(1);
  }

  process.stdout.write(`${signToken(userId, secret, ttl)}\n`);
}

main();
