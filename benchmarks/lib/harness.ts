import { Bench } from "tinybench";
import { benchConfig } from "../config/bench.config";

export type Params = Readonly<Record<string, number | string>>;

export interface BenchCase {
  name: string;
  /** What this case varies, such as { objects: 400 }. Sweeps are read from these. */
  params: Params;
  /** The timed work. Feed its result to `consume` so it cannot be optimized away. */
  run: () => unknown;
  /** Set when `run` returns a promise, so the timing waits for it to settle instead of stopping at its creation. */
  async?: boolean;
  /** Runs before every iteration, outside the timed region, to rebuild state the work changes. */
  prepare?: () => void;
}

export interface CaseResult {
  name: string;
  params: Params;
  samples: number;
  /** Milliseconds. */
  median: number;
  p95: number;
  p99: number;
  mad: number;
  mean: number;
  opsPerSecond: number;
}

function quantile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

/** Median absolute deviation: how far a typical sample sits from the median, immune to outliers. */
function medianAbsoluteDeviation(sorted: readonly number[], median: number): number {
  return quantile(
    sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b),
    0.5,
  );
}

function summarize(testCase: BenchCase, samples: readonly number[]): CaseResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  return {
    name: testCase.name,
    params: testCase.params,
    samples: sorted.length,
    median,
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    mad: medianAbsoluteDeviation(sorted, median),
    mean,
    opsPerSecond: mean > 0 ? 1000 / mean : Infinity,
  };
}

/**
 * Times each case with tinybench: warmup first, then many samples, reporting the distribution and not
 * one number. Cases run one after another so they share the same machine conditions.
 */
export async function measureCases(cases: readonly BenchCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const testCase of cases) {
    const bench = new Bench({
      time: benchConfig.timeMs,
      warmupTime: benchConfig.warmupMs,
      warmupIterations: 5,
      iterations: benchConfig.minSamples,
      retainSamples: true,
    });
    const hooks = testCase.prepare ? { beforeEach: testCase.prepare } : {};
    // A synchronous task is not wrapped in a promise, which would add its own cost to fast functions.
    if (testCase.async) bench.add(testCase.name, async () => void (await testCase.run()), hooks);
    else bench.add(testCase.name, () => void testCase.run(), hooks);
    await bench.run();
    const result = bench.tasks[0]?.result;
    if (!result || !("latency" in result) || !result.latency.samples)
      throw new Error(`No samples were collected for "${testCase.name}"`);
    results.push(summarize(testCase, [...result.latency.samples]));
  }
  return results;
}

/**
 * The exponent e in time ~ size^e between consecutive sizes of a sweep, using medians. 0 means constant,
 * 1 linear, 2 quadratic. Needs at least two cases that vary `key`.
 */
export function growthExponents(results: readonly CaseResult[], key: string): number[] {
  const ordered = results
    .map((result) => ({ size: Number(result.params[key]), time: result.median }))
    .sort((a, b) => a.size - b.size);
  const exponents: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current || previous.time <= 0 || previous.size <= 0) continue;
    exponents.push(Math.log(current.time / previous.time) / Math.log(current.size / previous.size));
  }
  return exponents;
}

/** The slope of a least-squares line through log(time) against log(size): the growth of the sweep as a whole. */
function fittedExponent(results: readonly CaseResult[], key: string): number {
  const points = results
    .map((result) => ({ size: Number(result.params[key]), time: result.median }))
    .filter((point) => point.size > 0 && point.time > 0)
    .map((point) => ({ x: Math.log(point.size), y: Math.log(point.time) }));
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  return variance === 0 ? 0 : covariance / variance;
}

/**
 * The exponent a sweep is judged by: the lower of the median step and the fitted slope. A single noisy
 * step, or one where a table is rebuilt, drags one of the two up but not the other, while a function that
 * really grows faster than declared shows it in every step and in the fit. So the check does not cry wolf
 * on microsecond-scale cases, and still fails on a genuine regression.
 */
export function typicalExponent(results: readonly CaseResult[], key: string): number {
  const steps = growthExponents(results, key).sort((a, b) => a - b);
  const median = steps.length === 0 ? 0 : quantile(steps, 0.5);
  return Math.min(median, fittedExponent(results, key));
}

/**
 * Checks that a function grows no faster than declared. `declared` is the exponent of the claimed
 * complexity (1 for O(n)); the measured exponent may exceed it by the configured tolerance for noise and
 * cache effects, but not more. Throws with the numbers when the claim does not hold.
 */
export function assertGrowth(
  results: readonly CaseResult[],
  key: string,
  declared: number,
  tolerance: number = benchConfig.growthTolerance,
): number {
  const measured = typicalExponent(results, key);
  if (measured > declared + tolerance) {
    const steps = growthExponents(results, key)
      .map((value) => value.toFixed(2))
      .join(", ");
    throw new Error(`Declared growth n^${declared} in "${key}" but measured n^${measured.toFixed(2)} (steps: ${steps}).`);
  }
  return measured;
}
