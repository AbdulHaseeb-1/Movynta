# Benchmarks

Reproducible measurements of the code paths a user feels: selecting and editing objects, importing models,
reopening projects, listing projects, and the backend work behind them. Tests check that code is correct;
these check how long it takes, and how that grows with the size of the input.

## Run

```bash
pnpm --filter movynta-benchmarks bench            # every suite (several minutes)
pnpm --filter movynta-benchmarks bench:desktop    # editor, import, projects, viewport suites
pnpm --filter movynta-benchmarks bench:backend    # backend suites (builds the backend first)
pnpm --filter movynta-benchmarks exec vitest run --config vitest.config.ts suites/editor/pick   # one suite
```

Each run prints a table, saves the raw samples under `results/` (git-ignored) and, when a baseline exists in
`baselines/`, lists any case that regressed. Set `BENCH_GATE=1` to make a regression fail the run, and
`BENCH_UPDATE_BASELINE=1` to replace the baselines (do this deliberately, with a commit message saying what
changed and why).

```bash
node benchmarks/summarize.mjs editor        # print the latest results of suites starting with "editor"
node benchmarks/snapshot.mjs before         # freeze the latest results as baselines/before/
node benchmarks/compare.mjs before          # speedup of every case against the frozen numbers
```

Read `config/environment.md` before keeping numbers: they only compare under the same conditions.

### Procedural command and bounds smoke measurements

Run `pnpm --filter movynta-backend test -- --runInBand --runTestsByPath src/modules/tools/procedural/procedural.runner.spec.ts` for interpreter limits and warm command-generation timing. Run `pnpm --filter movynta-desktop exec vitest run src/features/assistant/sceneBounds.test.ts src/features/assistant/EditorScene.performance.test.ts --reporter=verbose` for bounds and snapshot timing. These are smoke measurements, not regression gates.

On the implementation machine (2026-11-03), 20 warm 200-command generations averaged 5.7ms. Twenty snapshots of 2,000 box meshes including world bounds averaged 6.4ms; 100 snapshots of 2,000 empty objects averaged 2.8ms. Bounds are aggregated bottom-up in O(nodes), with cached geometry bounding boxes; computing previously unmeasured geometry bounds additionally costs O(vertices). Results vary with geometry and hardware.

For surface operations run `pnpm --filter movynta-desktop exec vitest run src/features/meshGeometry/meshGeometry.test.ts src/features/meshGeometry/modifierFeatures.test.ts --reporter=verbose`. The attribute-preserving evaluator averaged about 7ms for twenty bevel-plus-two-level-subdivision runs on a UV-mapped cube, compared with roughly 1–4ms for the earlier position-only implementation. This is a small-mesh smoke measurement, not a throughput guarantee. Topology reconstruction and Catmull–Clark passes follow vertices/edges/face corners; output grows approximately fourfold per subsequent quad subdivision level. Bevel checks local face insets and vertex patches instead of testing every vertex against every face for global convexity. Attribute and morph interpolation adds work proportional to output vertices, channel sizes, target counts and interpolation stencil sizes. Subdivision checks projected growth before allocating intermediate levels. Limits on triangle counts, stack size, extraordinary vertex valence and output attribute memory reject oversized work before committing changes. Adjacent render groups with the same material are coalesced to avoid a draw call per output face.

## Layout

Prepared assistant edits also have a smoke benchmark in `EditorScene.prepared.test.ts`. Ten prepare/discard cycles on a 100-box scene averaged about 6.3ms locally. Preparing isolates geometry/material resources and copies the scene; its cost grows with scene data. A conservative 128 MiB geometry-buffer budget bounds this path. Undo/redo replays saved history and reloads assets, so its cost grows with history and imported geometry; checkpointing remains an optimization opportunity.

| Folder | Holds |
| --- | --- |
| `config/` | Sampling time, thresholds, seed; the environment checklist |
| `lib/` | The shared harness (tinybench, percentiles, growth checks), environment capture, reporting |
| `fixtures/` | Seeded generators for scenes, models and database content |
| `suites/<area>/` | One `*.bench.ts` per feature, each opening with a bench card |
| `baselines/` | Committed reference results; `before/` holds the numbers from before the optimizations |
| `results/`, `reports/` | Raw runs and generated comparisons (git-ignored) |

## What each suite measures

| Suite | Subject | Tier | Declared growth |
| --- | --- | --- | --- |
| `editor/execute` | `EditorScene` transforms, deletes, restore, context reads | HIGH | O(batch); restore O(steps); context O(objects) |
| `editor/selection` | Group drag step, rectangle select, select all, many objects at once | HIGH | O(selected objects); rectangle O(objects) |
| `editor/pick` | `pickObjectId` on many objects and on one dense mesh | HIGH | O(objects), O(triangles hit) |
| `editor/componentHighlight` | Building Edit-mode face highlights for varying selection and mesh sizes | HIGH | O(selected face triangles); index construction excluded |
| `editor/componentPreparation` | Repeated preparation of unchanged meshes when switching selection modes | HIGH | O(mesh size) for a new picking buffer; topology parsing and triangulation cached |
| `editor/frame` | Per-frame gizmo sync and the panel's number helpers | HIGH | O(1) |
| `importer/import` | `prepareModel`, OBJ and STL reading, naming | HIGH | O(vertices), O(file) |
| `projects/helpers` | Store reducers, chat restore, card text | MEDIUM | O(items) |
| `backend/scenes` | Recording and reading a project's history, files | HIGH | O(1) per edit; O(history) to read |
| `backend/projects` | Listing, searching and deleting projects | HIGH | O(projects + runs) |
| `backend/validator` | Checking a proposed batch against the scene | MEDIUM | O(objects + commands) |
| `backend/signin` | PKCE, token claims | LOW | O(1) |
| `viewport/render.browser` | Frame cost with and without the selection outline | HIGH | O(pixels + selected triangles) |

The growth column is checked: a suite fails when a sweep grows faster than declared (see `assertGrowth` in
`lib/harness.ts`), and the measured exponent is printed. The exponent is the lower of the median step between
sizes and the slope fitted through the whole sweep, so one noisy step cannot fail a suite and a real
regression, which shows in both, still does. Where a sweep is memory-bound the tolerance is widened
in the suite, with the reason beside it.

## The browser render benchmark

`suites/viewport/render.browser.ts` needs a real browser: it draws frames with WebGL and forces the GPU to finish
each one. With `pnpm --filter movynta-desktop dev` serving, open the app in the browser pane and run:

```js
const m = await import("/@fs/<repo path>/benchmarks/suites/viewport/render.browser.ts");
console.log(JSON.stringify(await m.runRenderBenchmark()));
```

It alternates frames between the variants, so slow drift in the machine's load affects all of them equally.

## Adding a benchmark

1. Decide the tier with the triage in the bench card (per-frame or per-request, user-controlled size,
   super-linear complexity, I/O, memory). A function with none of these does not need one.
2. Put a seeded generator in `fixtures/` and a `*.bench.ts` in the matching `suites/` folder, starting with
   the bench card.
3. Use `measureCases` and `finishWithGrowth`; feed every result to `consume` so it cannot be optimized away;
   build state in `prepare`, never in the timed function; set `async: true` for functions that return a promise.
4. Run it twice, then `BENCH_UPDATE_BASELINE=1` to record its baseline.
