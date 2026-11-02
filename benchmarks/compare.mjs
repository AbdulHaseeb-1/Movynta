// Compares two saved sets of results, case by case: `node compare.mjs before [after]`.
// "after" defaults to the latest run of every suite. Prints the speedup of each case (before / after).
import { readdirSync, readFileSync } from "node:fs";

const base = new URL("./", import.meta.url);
const beforeFolder = process.argv[2] ?? "before";

function loadFolder(folder) {
  const reports = new Map();
  const dir = new URL(`./baselines/${folder}/`, base);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")))
    reports.set(JSON.parse(readFileSync(new URL(file, dir), "utf8")).suite, JSON.parse(readFileSync(new URL(file, dir), "utf8")));
  return reports;
}

function loadLatest() {
  const reports = new Map();
  const dir = new URL("./results/", base);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const report = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    reports.set(report.suite, report);
  }
  return reports;
}

const before = loadFolder(beforeFolder);
const after = process.argv[3] ? loadFolder(process.argv[3]) : loadLatest();
const key = (result) => `${result.name} | ${Object.entries(result.params).map(([k, v]) => `${k}=${v}`).join(" ")}`;
const rows = [];
for (const [suite, report] of after) {
  const old = before.get(suite);
  if (!old) continue;
  const index = new Map(old.results.map((result) => [key(result), result]));
  for (const result of report.results) {
    const previous = index.get(key(result));
    if (!previous || previous.median < 0.002) continue; // below 2 microseconds the timer dominates
    rows.push({ suite, name: key(result), before: previous.median, after: result.median, speedup: previous.median / result.median });
  }
}
rows.sort((a, b) => b.speedup - a.speedup);
const fmt = (value) => (value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(3));
for (const row of rows)
  console.log(`${row.speedup.toFixed(1).padStart(7)}x  ${fmt(row.before).padStart(9)} -> ${fmt(row.after).padStart(9)} ms  ${row.suite}  ${row.name}`);
const slower = rows.filter((row) => row.speedup < 0.8);
console.log(`\n${rows.length} comparable cases; ${rows.filter((row) => row.speedup >= 2).length} at least 2x faster; ${slower.length} slower than before.`);
