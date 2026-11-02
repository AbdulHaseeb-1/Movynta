/** Sampling and gating settings shared by every suite. Change them here, not in a suite. */
export const benchConfig = {
  /** Time spent sampling each case, in milliseconds. */
  timeMs: 350,
  /** Time spent warming each case up before sampling, in milliseconds. */
  warmupMs: 150,
  /** A case collects at least this many samples. */
  minSamples: 12,
  /** Seed for every generated fixture, so two runs do the same work. */
  seed: 20260402,
  /**
   * Regression limits against a committed baseline, as a fraction. They are wide because the numbers
   * come from a developer machine; tighten them when the suite runs on dedicated hardware.
   */
  thresholds: { median: 0.25, p95: 0.4 },
  /** A sweep may grow this much faster than its declared exponent before it counts as a failure. */
  growthTolerance: 0.35,
} as const;
