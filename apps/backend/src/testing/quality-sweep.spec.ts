import "reflect-metadata";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { ProvidersService } from "../modules/providers/providers.service.js";
import type { SecretProtector } from "../modules/providers/secret-protector.js";
import { signToken } from "../modules/auth/token.js";
import { TEST_AUTH_SECRET } from "./constants.js";
import { startTestServer } from "./test-app.js";

/*
 * Runs the assistant quality benchmark (see benchmarks/README.md) against the real backend and any OpenAI-compatible
 * endpoint, on any operating system. The app stores provider keys with Windows DPAPI, so on another system the backend
 * cannot be started with a saved provider; this boots it in-process with the key held in memory only and points the
 * benchmark runner at it. Nothing is written to disk or sent anywhere but the endpoint.
 *
 * It calls a real model and does nothing unless SWEEP_API_KEY and SWEEP_MODEL are set:
 *
 *   SWEEP_API_KEY=... SWEEP_BASE_URL=https://openrouter.ai/api/v1 SWEEP_MODEL=vendor/model \
 *     SWEEP_REVIEW_MODE=builds SWEEP_TRIALS=2 pnpm --filter movynta-backend test --runInBand src/testing/quality-sweep.spec.ts
 *
 * Also read: SWEEP_SCENARIOS (comma-separated ids), SWEEP_TIMEOUT_MS per run, SWEEP_LABEL, SWEEP_LOG (file for the
 * runner's output), and SWEEP_MODEL_SUFFIX (refuse any model whose id does not end with it, such as ":free").
 */
const env = process.env;
const key = env["SWEEP_API_KEY"] ?? "";
const model = env["SWEEP_MODEL"] ?? "";
const enabled = key !== "" && model !== "";

// In memory only: the database lives as long as this process, so the key is never written anywhere.
const vault: SecretProtector = {
  protect: (value) => Promise.resolve(Buffer.from(value, "utf8").toString("base64")),
  unprotect: (value) => Promise.resolve(Buffer.from(value, "base64").toString("utf8")),
};

(enabled ? it : it.skip)("runs the quality benchmark against the configured endpoint", async () => {
  const suffix = env["SWEEP_MODEL_SUFFIX"];
  if (suffix && !model.endsWith(suffix)) throw new Error(`Refusing to use "${model}": its id does not end with "${suffix}"`);
  process.env["AGENT_REVIEW_MODE"] = env["SWEEP_REVIEW_MODE"] ?? "off";
  process.env["AGENT_RUN_IDLE_TIMEOUT_MS"] = "600000";
  const server = await startTestServer(0, { runTimeoutMs: 20 * 60 * 1000, secretProtector: vault });
  try {
    const userId = "quality-bench";
    await server.app.get(ProvidersService).save(userId, "openai-compatible", model, key, env["SWEEP_BASE_URL"] ?? "https://api.openai.com/v1", false);
    const log = createWriteStream(env["SWEEP_LOG"] ?? "/dev/null");
    const child = spawn("pnpm", ["--filter", "movynta-benchmarks", "quality"], {
      cwd: "../..",
      env: {
        ...env,
        SWEEP_API_KEY: "",
        // Longer than a sweep can take: the login in a test server defaults to an hour.
        QUALITY_TOKEN: signToken(userId, TEST_AUTH_SECRET, 12 * 3600),
        QUALITY_BACKEND_URL: server.baseUrl,
        QUALITY_PROVIDER: "openai-compatible",
        QUALITY_MODEL: model,
        QUALITY_LABEL: env["SWEEP_LABEL"] ?? "sweep",
        QUALITY_TRIALS: env["SWEEP_TRIALS"] ?? "1",
        QUALITY_SCENARIOS: env["SWEEP_SCENARIOS"] ?? "",
        QUALITY_TIMEOUT_MS: env["SWEEP_TIMEOUT_MS"] ?? "600000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    log.end();
    expect(code).toBe(0);
  } finally {
    await server.close();
  }
}, 6 * 60 * 60 * 1000);
