/*
 * BENCH: ChatGPT sign-in helpers that run on every login and refresh
 * TIER: LOW
 * SUBJECT: apps/backend/src/modules/providers/chatgpt (generatePkce, generateState, readTokenClaims),
 *          apps/backend/src/modules/providers/model-capabilities.ts#reasoningEffortsFor
 * MEASURES: latency
 * COMPLEXITY: O(1); the token size is fixed by the issuer
 * INPUTS: one realistic id token (about 1.2 KB); seed-free (crypto), fixed token
 * BASELINE: baselines/backend/signin.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: the token endpoint, DPAPI (a PowerShell process, measured by the network and OS, not here)
 * NOTES: dominated by crypto and JSON parsing; recorded so a regression in either is visible.
 */
import "reflect-metadata";
import { describe, it } from "vitest";
import { generatePkce, generateState } from "../../../apps/backend/src/modules/providers/chatgpt/chatgpt-pkce";
import { readTokenClaims } from "../../../apps/backend/src/modules/providers/chatgpt/chatgpt-token-claims";
import { reasoningEffortsFor } from "../../../apps/backend/src/modules/providers/model-capabilities";
import { measureCases } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = [
  encode({ alg: "RS256", typ: "JWT" }),
  encode({
    email: "person@example.com",
    exp: 1_793_600_000,
    "https://api.openai.com/auth": { chatgpt_account_id: "acct_123", chatgpt_plan_type: "plus", padding: "x".repeat(700) },
  }),
  "signature".repeat(40),
].join(".");

describe("sign-in helpers", () => {
  it("measures PKCE, claims and capability lookups", async () => {
    const results = await measureCases([
      { name: "generatePkce", params: { calls: 1 }, run: () => consume(generatePkce().challenge.length) },
      { name: "generateState", params: { calls: 1 }, run: () => consume(generateState().length) },
      { name: "readTokenClaims", params: { bytes: idToken.length }, run: () => consume(readTokenClaims(idToken).accountId?.length ?? 0) },
      { name: "reasoningEffortsFor", params: { calls: 1 }, run: () => consume(reasoningEffortsFor("chatgpt", "gpt-6-luna").length) },
    ]);
    finishWithGrowth("backend/signin", results, []);
  });
});
