import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchConfig } from "../config/bench.config";
import { captureEnvironment, type BenchEnvironment } from "./env";
import { assertGrowth, typicalExponent, type CaseResult } from "./harness";
import { sinkValue } from "./sink";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface SuiteReport {
  suite: string;
  environment: BenchEnvironment;
  sink: number;
  results: CaseResult[];
  /** Measured growth exponents by sweep key, for suites that validate a declared complexity. */
  growth: Record<string, number>;
}

function format(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

function describeParams(result: CaseResult): string {
  return Object.entries(result.params)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

/** Cases whose median or p95 got worse than the thresholds allow, compared by case name and parameters. */
export function compareWithBaseline(current: SuiteReport, baseline: SuiteReport): string[] {
  const key = (result: CaseResult) => `${result.name}|${describeParams(result)}`;
  const before = new Map(baseline.results.map((result) => [key(result), result]));
  const problems: string[] = [];
  for (const result of current.results) {
    const old = before.get(key(result));
    if (!old) continue;
    const medianChange = (result.median - old.median) / old.median;
    const p95Change = (result.p95 - old.p95) / old.p95;
    // A change counts only when it also exceeds the run-to-run spread the baseline recorded.
    if (medianChange > benchConfig.thresholds.median && result.median - old.median > 3 * old.mad) {
      problems.push(
        `${result.name} ${describeParams(result)}: median ${format(old.median)} -> ${format(result.median)} ms (+${(medianChange * 100).toFixed(0)}%)`,
      );
    } else if (p95Change > benchConfig.thresholds.p95 && result.p95 - old.p95 > 3 * old.mad) {
      problems.push(
        `${result.name} ${describeParams(result)}: p95 ${format(old.p95)} -> ${format(result.p95)} ms (+${(p95Change * 100).toFixed(0)}%)`,
      );
    }
  }
  return problems;
}

/** A claim about how a sweep grows: the exponent of the declared complexity, for the cases that match. */
export interface GrowthClaim {
  /** The parameter the sweep varies. */
  key: string;
  /** 0 for constant time, 1 for O(n), 2 for O(n^2). */
  declared: number;
  /** Names the claim in the report when a suite makes several; defaults to the parameter. */
  label?: string;
  where?: (result: CaseResult) => boolean;
  /** Overrides the default tolerance, for sweeps known to be memory-bound. Say why where it is used. */
  tolerance?: number;
}

/**
 * Reports a suite, then checks its growth claims. The numbers are printed and saved first, so a claim
 * that does not hold still shows the data that disproves it.
 */
export function finishWithGrowth(suite: string, results: CaseResult[], claims: readonly GrowthClaim[]): SuiteReport {
  const growth: Record<string, number> = {};
  for (const claim of claims)
    growth[claim.label ?? claim.key] = typicalExponent(results.filter(claim.where ?? (() => true)), claim.key);
  const report = finishSuite(suite, results, growth);
  for (const claim of claims)
    assertGrowth(results.filter(claim.where ?? (() => true)), claim.key, claim.declared, claim.tolerance);
  return report;
}

/** Prints a table, saves the raw run under results/, and compares it with the committed baseline. */
export function finishSuite(
  suite: string,
  results: CaseResult[],
  growth: Record<string, number> = {},
): SuiteReport {
  const report: SuiteReport = {
    suite,
    environment: captureEnvironment(benchConfig.seed),
    sink: sinkValue(),
    results,
    growth,
  };
  const lines = results.map(
    (result) =>
      `  ${result.name.padEnd(46)} ${describeParams(result).padEnd(26)} median ${format(result.median).padStart(9)} ms  p95 ${format(result.p95).padStart(9)}  p99 ${format(result.p99).padStart(9)}  mad ${format(result.mad).padStart(8)}  n=${result.samples}`,
  );
  const exponents = Object.entries(growth).map(([key, value]) => `  growth in ${key}: n^${value.toFixed(2)}`);
  console.log([`\n[${suite}]`, ...lines, ...exponents].join("\n"));

  const stamp = report.environment.timestamp.replace(/[:.]/g, "-");
  const resultsFile = join(root, "results", `${suite.replace(/\//g, "-")}.${stamp}.json`);
  mkdirSync(dirname(resultsFile), { recursive: true });
  writeFileSync(resultsFile, JSON.stringify(report, null, 2));

  const baselineFile = join(root, "baselines", `${suite}.baseline.json`);
  if (process.env["BENCH_UPDATE_BASELINE"] === "1") {
    mkdirSync(dirname(baselineFile), { recursive: true });
    writeFileSync(baselineFile, JSON.stringify(report, null, 2));
    console.log(`  baseline updated: ${baselineFile}`);
  } else if (existsSync(baselineFile)) {
    const regressions = compareWithBaseline(report, JSON.parse(readFileSync(baselineFile, "utf8")) as SuiteReport);
    if (regressions.length > 0) {
      console.log(["  REGRESSIONS against baseline:", ...regressions.map((line) => `    ${line}`)].join("\n"));
      if (process.env["BENCH_GATE"] === "1") throw new Error(`${suite} regressed:\n${regressions.join("\n")}`);
    }
  }
  return report;
}
