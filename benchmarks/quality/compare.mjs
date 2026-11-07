#!/usr/bin/env node
// Compares two assistant quality result files, scenario by scenario.
//   node benchmarks/quality/compare.mjs results/quality/<before>.json results/quality/<after>.json
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("Usage: compare.mjs <before.json> <after.json>");
  process.exit(1);
}
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const before = read(beforePath);
const after = read(afterPath);
const percent = (value) => `${Math.round(value * 100)}%`;
const signed = (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}`;

const ids = [...new Set([...before.scorecard.scenarios, ...after.scorecard.scenarios].map((row) => row.scenarioId))];
const byId = (card) => new Map(card.scenarios.map((row) => [row.scenarioId, row]));
const a = byId(before.scorecard);
const b = byId(after.scorecard);
const width = Math.max(8, ...ids.map((id) => id.length));

console.log(`before: ${before.label} (${before.config.model ?? "default model"}, ${before.scorecard.trials} trials, ${before.gitSha ?? "no commit"})`);
console.log(`after:  ${after.label} (${after.config.model ?? "default model"}, ${after.scorecard.trials} trials, ${after.gitSha ?? "no commit"})\n`);
console.log(`${"scenario".padEnd(width)}  before  after  change`);
for (const id of ids) {
  const x = a.get(id);
  const y = b.get(id);
  const change = x && y ? `${signed(y.meanRatio - x.meanRatio)} pts` : "–";
  console.log(`${id.padEnd(width)}  ${(x ? percent(x.meanRatio) : "–").padStart(6)}  ${(y ? percent(y.meanRatio) : "–").padStart(5)}  ${change.padStart(6)}`);
}
console.log(`\noverall ${percent(before.scorecard.meanRatio)} -> ${percent(after.scorecard.meanRatio)} (${signed(after.scorecard.meanRatio - before.scorecard.meanRatio)} pts); perfect trials ${percent(before.scorecard.perfectRate)} -> ${percent(after.scorecard.perfectRate)}`);
if (Math.min(before.scorecard.trials, after.scorecard.trials) < ids.length * 3) {
  console.log("Few trials per scenario: a model's answers vary from run to run, so treat small changes as noise. Use QUALITY_TRIALS=3 or more.");
}
