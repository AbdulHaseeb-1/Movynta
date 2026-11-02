import { readdirSync, readFileSync } from "node:fs";
const dir = new URL("./results/", import.meta.url);
const latest = new Map();
for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
  const report = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  latest.set(report.suite, report);
}
const wanted = process.argv.slice(2);
for (const [suite, report] of latest) {
  if (wanted.length && !wanted.some((prefix) => suite.startsWith(prefix))) continue;
  console.log(`[${suite}]`);
  for (const r of report.results)
    console.log(`  ${r.name.padEnd(44)} ${Object.entries(r.params).map(([k, v]) => k + "=" + v).join(" ").padEnd(22)} median ${r.median.toFixed(3).padStart(9)}  p95 ${r.p95.toFixed(3).padStart(9)}  p99 ${r.p99.toFixed(3).padStart(9)}`);
  for (const [k, v] of Object.entries(report.growth)) console.log(`  growth in ${k}: n^${v.toFixed(2)}`);
}
