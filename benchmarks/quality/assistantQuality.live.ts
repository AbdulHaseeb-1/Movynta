/*
 * QUALITY: How well the assistant does real modeling requests
 * SUBJECT: the whole assistant: prompt, tools, skills and run loop, through a running backend and its configured model
 * MEASURES: the share of acceptance checks each result passes (sizes, placement, symmetry, loose parts, closed solids),
 *           plus time and tokens
 * INPUTS: apps/desktop/src/features/assistant/qualityScenarios (requests, hidden checks, known answers)
 * NEEDS: a running backend and a bearer token for the user whose provider is configured; see benchmarks/README.md
 * NOTES: Calls the model and costs money. Only runs when QUALITY_TOKEN is set. Results go to results/quality/.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { formatScorecard, QUALITY_SCENARIOS, runScenarioLive, summarizeRuns, type LiveRunResult } from "@/features/assistant/qualityScenarios";

const env = process.env;
const token = env["QUALITY_TOKEN"];

function positiveInt(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive whole number`);
  return value;
}

function chosenScenarios() {
  const ids = (env["QUALITY_SCENARIOS"] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return QUALITY_SCENARIOS;
  const unknown = ids.filter((id) => !QUALITY_SCENARIOS.some((scenario) => scenario.id === id));
  if (unknown.length > 0) throw new Error(`Unknown scenarios: ${unknown.join(", ")}. Choose from ${QUALITY_SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
  return QUALITY_SCENARIOS.filter((scenario) => ids.includes(scenario.id));
}

function gitSha(): string | undefined {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return undefined; }
}

if (!token) {
  console.log("Assistant quality runs are off. Set QUALITY_TOKEN (see benchmarks/README.md, \"Assistant quality\") to run them.");
}

describe.skipIf(!token)("assistant quality", () => {
  it("runs each scenario against the backend and scores the result", async () => {
    const trials = positiveInt("QUALITY_TRIALS", 1);
    const timeoutMs = positiveInt("QUALITY_TIMEOUT_MS", 10 * 60 * 1000);
    const label = (env["QUALITY_LABEL"] ?? "run").replace(/[^A-Za-z0-9._-]/g, "-");
    const options = {
      baseUrl: env["QUALITY_BACKEND_URL"] ?? "http://127.0.0.1:3001",
      token: token ?? "",
      timeoutMs,
      ...(env["QUALITY_PROVIDER"] ? { providerId: env["QUALITY_PROVIDER"] } : {}),
      ...(env["QUALITY_MODEL"] ? { model: env["QUALITY_MODEL"] } : {}),
      ...(env["QUALITY_EFFORT"] ? { reasoningEffort: env["QUALITY_EFFORT"] } : {}),
    };

    const results: LiveRunResult[] = [];
    const errors: { scenarioId: string; trial: number; message: string }[] = [];
    const startedAt = new Date().toISOString();
    const folder = resolve(dirname(fileURLToPath(import.meta.url)), "../results/quality");
    mkdirSync(folder, { recursive: true });
    const file = resolve(folder, `${startedAt.replace(/[:.]/g, "-")}-${label}.json`);
    const config = { baseUrl: options.baseUrl, providerId: options.providerId ?? null, model: options.model ?? null, reasoningEffort: options.reasoningEffort ?? null, trials, timeoutMs };
    // Saved after every run, so a long sweep that stops half way still leaves what it finished.
    const save = () => writeFileSync(file, JSON.stringify({ label, startedAt, gitSha: gitSha() ?? null, config, scorecard: summarizeRuns(results), results, errors }, null, 2));

    for (const scenario of chosenScenarios()) {
      for (let trial = 1; trial <= trials; trial += 1) {
        // One run at a time: the backend allows one active run per project, and timings stay comparable.
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await runScenarioLive(scenario, trial, options);
          results.push(result);
          const failing = result.score.results.filter((entry) => entry.status !== "pass").map((entry) => entry.label);
          console.log(`${scenario.id} #${trial}: ${Math.round(result.score.ratio * 100)}% (${result.status}, ${(result.durationMs / 1000).toFixed(0)}s)${failing.length > 0 ? ` failed: ${failing.join("; ")}` : ""}`);
        } catch (error) {
          // A run that could not happen at all (the backend refused, the connection dropped) is recorded, not fatal.
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ scenarioId: scenario.id, trial, message });
          console.log(`${scenario.id} #${trial}: could not run: ${message}`);
        }
        save();
      }
    }

    console.log(`\n${formatScorecard(summarizeRuns(results))}\n`);
    if (errors.length > 0) console.log(`${errors.length} run${errors.length === 1 ? "" : "s"} could not be made; see "errors" in the results file.\n`);
    console.log(`Saved ${file}`);
  });
});
