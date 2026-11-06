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

## Assistant quality

Performance benchmarks say how fast the editor is. These say how good the assistant's work is. They give the assistant a request, let it work through a running backend and its configured model, and score what it leaves behind with checks the assistant never sees. The same score lets you compare two configurations of the assistant (a different model, prompt, tool set or agent design) on the same requests.

**Scenarios** live in `apps/desktop/src/features/assistant/qualityScenarios/`. Each has a prompt a user would type, the scene it starts from, hidden acceptance checks, and a known answer written as editor commands.

| Scenario | Asks for | Checks |
| --- | --- | --- |
| `chair` | A simple dining chair standing on the floor | Height, width and depth in range, on the floor, centered, no loose parts, at least 6 parts |
| `table` | A dining table for four | Table height, length, width, on the floor, centered, no loose parts, at least 5 parts |
| `sword` | A one-handed sword, point up on its pommel | Length, width, on the floor, centered, no loose parts, at least 4 parts |
| `mug` | A coffee mug with a handle | Height, depth, width with handle, resting on the table, handle attached, at least 2 parts |
| `figure` | A standing human blockout about 1.75 m tall | Height, width, depth, feet on the floor, centered, no loose parts, at least 6 parts |
| `halve-block` | Cut a block in half and remove one side | Half as wide, same height and depth, left half gone, still a closed solid |
| `quarter-block` | Cut a block into a quarter with two cuts, the second across the first | Half as wide and deep, same height, the right-front quarter kept, a quarter of the volume, still closed |
| `open-tube` | Remove the top cap of a tube | One opening, at the top, 17 faces left, same height and width |
| `inside-out` | Fix a crate whose faces point inward | Positive volume, same height, still closed |

For a scene the assistant builds, the checks measure everything it added as one group (`SUBJECT_ID`), so they hold whatever it names its parts. For an edit they name the objects the scene started with. Edits are also scored on the mesh itself, which bounds cannot show: whether it is a closed solid, the volume it encloses (negative when its faces point inward), how many holes it has and where, and how many faces are left. Mesh measurements are taken on the base cage, so a scenario keeps its objects unscaled and unturned. Checks are the same ones the assistant can write for itself with `modeling.record_brief`, evaluated by `evaluateBrief` in `packages/editor-protocol`.

Each known answer is applied the way the assistant must send it: a command that edits a mesh's cage goes in a batch of its own, never with creation. That is how the benchmark found a real bug before any model ran: after a filled cut, the cap's texture mapping jumped between unrelated parts of the texture, so a second cut across it was refused and a block could not be cut into quarters.

**The checks are tested against real geometry.** `qualityScenarios.test.ts` (part of `pnpm --filter movynta-desktop test`) builds each known answer in the real `EditorScene` and requires a full score. It also builds each scenario's named defects (a floating backrest, a half-size chair, a sunk figure, a cut that leaves the solid open) and requires that they fail exactly the checks listed for them, and that every check is failed by at least one defect. So a check that could never fail, or a defect nobody notices, breaks the build. `liveRun.test.ts` drives the live runner through the bridge protocol against a stand-in backend that replays a known answer.

### Run it

```bash
# 1. Start the backend with a fixed signing secret (32 or more characters) so a token can be made for it.
AUTH_SECRET=<secret> pnpm dev:backend

# 2. Make a token for the desktop user, whose provider settings (Settings > Providers) the run then uses.
pnpm --filter movynta-backend build
AUTH_SECRET=<secret> pnpm --filter movynta-backend token desktop-local

# 3. Run. Nothing starts unless QUALITY_TOKEN is set.
QUALITY_TOKEN=<token> QUALITY_TRIALS=3 QUALITY_LABEL=baseline pnpm --filter movynta-benchmarks quality
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `QUALITY_TOKEN` | Bearer token from step 2. Required. | none |
| `QUALITY_BACKEND_URL` | Where the backend listens | `http://127.0.0.1:3001` |
| `QUALITY_SCENARIOS` | Comma-separated scenario ids | all |
| `QUALITY_TRIALS` | Runs per scenario. A model's answers vary, so use 3 or more to compare. | 1 |
| `QUALITY_TIMEOUT_MS` | Longest one run may take before it is cancelled and scored as it stands | 600000 |
| `QUALITY_PROVIDER`, `QUALITY_MODEL`, `QUALITY_EFFORT` | Override the provider, model and reasoning effort for the sweep | the app's active provider |
| `QUALITY_LABEL` | Name used in the results file | `run` |

**Measuring the independent review.** A finished build is examined by a separate reviewer agent only when the backend's `AGENT_REVIEW_MODE` says so. The benchmark prompts do not ask for realism, so the default (`quality`) never reviews them. To see what the review adds, run one sweep per mode on the same model and compare:

```bash
AGENT_REVIEW_MODE=off    AUTH_SECRET=<secret> pnpm dev:backend   # then: QUALITY_LABEL=no-review ... quality
AGENT_REVIEW_MODE=builds AUTH_SECRET=<secret> pnpm dev:backend   # then: QUALITY_LABEL=review ... quality
```

The headless editor has no viewport, so the reviewer works from measurements: it can find fault and send the work back (up to `AGENT_REVIEW_LIMIT` times), but it can never approve, and every reviewed run ends with a "not visually verified" notice. That is enough to show whether the review catches defects the builder missed; it does not show what a reviewer who can see would add. A reviewed run costs noticeably more tokens and time, and the scorecard shows both.

Runs happen one at a time. Each uses a throwaway project named `quality-<scenario>-<trial>-<id>`, which is deleted once the run is scored. **A sweep calls the model and costs money**: six scenarios with three trials is eighteen full assistant runs.

The scorecard is printed and saved to `results/quality/<time>-<label>.json` with the commit, the settings and every run's score. Compare two sweeps:

```bash
node benchmarks/quality/compare.mjs results/quality/<before>.json results/quality/<after>.json
```

### What a score means and does not

- A score is the share of acceptance checks passed (sizes, placement, centering, loose parts, part count, closed solids). It says whether the assistant built the right *thing at the right size and put together*. It does not judge shape, silhouette or style; those still need eyes.
- The headless editor has no viewport, so a request to look at the scene (`viewport.capture`) is answered with an error and the assistant works from measurements. Runs are therefore comparable with each other, but they do not exercise the visual review loop.
- Prompts avoid the words that start the quality gate (realistic, detailed, refine), so a default backend does not review them and does not require a brief. The assistant is told to write a brief for any build, and that is part of what is measured. Start the backend with `AGENT_REVIEW_MODE=builds` to review them.
- With few trials a difference of one scenario is noise. Use three trials or more, and the same model, before drawing a conclusion.
- Live runs have only been exercised against a stand-in backend in tests. The first sweep against a real backend is the first test of that path end to end.

### Checker cost

`evaluateBrief` on a scene of N objects with 40 checks (20 size, 10 symmetric, 9 count by name prefix, one connected over all objects), measured on the implementation machine: 0.5 ms at 101 objects, 3.6 ms at 501, 7.2 ms at 1,001 and 40 ms at 2,000 (the editor's maximum). Name lookups are linear scans; the `connected` check compares parts pairwise, so it is the only part that grows faster than the scene.

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
| `editor/execute` | `EditorScene` transforms, deletes, creating a batch of same-named shapes, hiding a collection, restore, context reads | HIGH | O(batch); create batch O(objects); restore O(steps); context O(objects) |
| `editor/outline` | The scene outline: reading the objects, building and flattening the tree (with and without collections), a chain of nested objects | HIGH | O(objects); window O(1) |
| `editor/meshPath` | Following a mesh path into an imported model by index and by name, stable steps, listing parts, a batch with a Boolean on one part | MEDIUM | index O(depth); name O(children); stable steps O(children); staged batch with a Boolean O(parts) |
| `editor/selection` | Group drag step, rectangle select, select all, many objects at once | HIGH | O(selected objects); rectangle O(objects) |
| `editor/pick` | `pickObjectId` on many objects and on one dense mesh | HIGH | O(objects), O(triangles hit) |
| `editor/componentHighlight` | Building Edit-mode face highlights for varying selection and mesh sizes | HIGH | O(selected face triangles); index construction excluded |
| `editor/componentPreparation` | Repeated preparation of unchanged meshes when switching selection modes | HIGH | O(mesh size) for a new picking buffer; topology parsing and triangulation cached |
| `editor/extrudePreview` | Full face extrusion rebuild and repeated prepared preview updates, with and without the selection overlay | HIGH | O(mesh size); excludes GPU rendering and initial preparation from the prepared cases |
| `editor/faceModeling` | Face move with shaded preview, prepared face move with overlay, and a rounded cylindrical Boolean cut | HIGH | CPU work only, excluding GPU rendering |
| `editor/faceQuery` | Inspection of a dense mesh filtered by face normal and center | HIGH | Cached topology, full query and response construction |
| `editor/customMesh` | Validation and generation of a large structured polygon mesh | HIGH | CPU work only, including topology and render buffers |
| `editor/meshRepair` | Triangulation and validation of a warped hole boundary with up to 256 edges | MEDIUM | O(mesh size + boundary edges²); excludes rendering and buffer upload |
| `editor/knifeAndCuts` | Knife chord, a 30-cut knife path, plane cuts with and without keeping a side and capping, deleting a patch of faces, flipping every face and validating a whole cage, on cages of up to about 20,000 faces | HIGH | O(faces) for every case; a knife path is checked once, not after every cut. Before this suite a 32-cut path on 1,024 faces took 269 ms (now about 4 ms for 30 cuts) and a single checked chord took 13 ms at 1,024 faces and 32 ms at 4,096 (now 1.2 ms and 5.9 ms); no baseline is committed because numbers only compare on one machine |
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
