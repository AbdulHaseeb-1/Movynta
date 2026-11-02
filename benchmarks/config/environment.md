# Environment for comparable numbers

Numbers from two runs can be compared only when they were taken under the same conditions. Before a run
that you intend to keep (a baseline, or the "after" of an optimization):

- Use the normal (optimizing) Node runtime. Vitest runs the suites on Node's JIT; do not attach a debugger
  or run with `--inspect`, `--cpu-prof` or coverage.
- Build the backend first when a suite imports it from `dist` (the backend suites import from `src`, so
  this only matters for the browser render benchmark).
- Plug the machine into power and close heavy applications, browsers with many tabs and other test or build
  runs. A second benchmark running at the same time invalidates both.
- On Windows, choose the "Best performance" power mode. Let the machine idle for a minute after a build so the
  CPU is not still boosting or throttling.
- Run a suite twice and keep the second run. The first one warms the disk cache and the JIT.
- Compare only results recorded by the same machine. `results/*.json` record the CPU, core count, memory, OS,
  Node version, commit and whether the working tree had uncommitted changes.

The in-memory database (`:memory:`) means the backend suites do not measure disk speed. The GPU benchmark in
`suites/viewport/render.browser.ts` runs in a browser pane and measures whatever graphics device that pane uses,
which may be software rendering; only its ratios between variants mean anything there.
