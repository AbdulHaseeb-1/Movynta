import type { LiveRunResult } from "./liveRun";

export interface ScenarioSummary {
  readonly scenarioId: string;
  readonly trials: number;
  /** Mean share of checks passed, 0 to 1. */
  readonly meanRatio: number;
  readonly worstRatio: number;
  /** Trials that passed every check. */
  readonly perfect: number;
  /** Trials whose run failed or was cancelled; what they built is still scored. */
  readonly stoppedEarly: number;
  /** The checks that failed, most often first. */
  readonly failures: readonly { readonly label: string; readonly count: number }[];
  readonly meanSeconds: number;
  readonly meanTokens: number;
}

export interface Scorecard {
  readonly scenarios: readonly ScenarioSummary[];
  /** Mean of the scenario means, so a scenario counts once however many trials it had. */
  readonly meanRatio: number;
  /** Share of all trials that passed every check. */
  readonly perfectRate: number;
  readonly trials: number;
}

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

export function summarizeRuns(results: readonly LiveRunResult[]): Scorecard {
  const ids = [...new Set(results.map((result) => result.scenarioId))];
  const scenarios = ids.map((scenarioId): ScenarioSummary => {
    const runs = results.filter((result) => result.scenarioId === scenarioId);
    const counts = new Map<string, number>();
    for (const run of runs) for (const entry of run.score.results) if (entry.status !== "pass") counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
    return {
      scenarioId,
      trials: runs.length,
      meanRatio: mean(runs.map((run) => run.score.ratio)),
      worstRatio: Math.min(...runs.map((run) => run.score.ratio)),
      perfect: runs.filter((run) => run.score.ratio === 1).length,
      stoppedEarly: runs.filter((run) => run.status !== "completed").length,
      failures: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      meanSeconds: mean(runs.map((run) => run.durationMs / 1000)),
      meanTokens: mean(runs.map((run) => run.usage?.totalTokens ?? 0)),
    };
  });
  return {
    scenarios,
    meanRatio: mean(scenarios.map((scenario) => scenario.meanRatio)),
    perfectRate: results.length === 0 ? 0 : results.filter((result) => result.score.ratio === 1).length / results.length,
    trials: results.length,
  };
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** A plain-text table for the terminal: one line for each scenario, the checks that failed under it, and the totals. */
export function formatScorecard(card: Scorecard): string {
  const width = Math.max(8, ...card.scenarios.map((scenario) => scenario.scenarioId.length));
  const lines = [`${"scenario".padEnd(width)}  trials  score  perfect  stopped  seconds  tokens`];
  for (const row of card.scenarios) {
    lines.push(`${row.scenarioId.padEnd(width)}  ${String(row.trials).padStart(6)}  ${percent(row.meanRatio).padStart(5)}  ${`${row.perfect}/${row.trials}`.padStart(7)}  ${String(row.stoppedEarly).padStart(7)}  ${row.meanSeconds.toFixed(0).padStart(7)}  ${Math.round(row.meanTokens).toString().padStart(6)}`);
    for (const failure of row.failures) lines.push(`${" ".repeat(width)}    failed ${failure.count}/${row.trials}: ${failure.label}`);
  }
  lines.push("", `overall score ${percent(card.meanRatio)}, ${percent(card.perfectRate)} of ${card.trials} trials passed every check`);
  return lines.join("\n");
}
