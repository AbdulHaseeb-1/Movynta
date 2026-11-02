// Copies the latest saved run of every suite into baselines/<folder>/, e.g. `node snapshot.mjs before`.
// Used to freeze the numbers measured before an optimization so the result can be compared with them.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const folder = process.argv[2];
if (!folder) throw new Error("Usage: node snapshot.mjs <folder-name>");
const results = new URL("./results/", import.meta.url);
const latest = new Map();
for (const file of readdirSync(results).filter((name) => name.endsWith(".json")).sort()) {
  const report = JSON.parse(readFileSync(new URL(file, results), "utf8"));
  latest.set(report.suite, report);
}
const target = new URL(`./baselines/${folder}/`, import.meta.url);
mkdirSync(target, { recursive: true });
for (const [suite, report] of latest) {
  writeFileSync(new URL(`${suite.replace(/\//g, "-")}.json`, target), JSON.stringify(report, null, 2));
}
console.log(`${latest.size} suites saved to baselines/${folder}/`);
