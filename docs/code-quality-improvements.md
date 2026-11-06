# Code quality improvement plan

Observations from the 2026-11-06 code-quality pass. Both apps are in good shape overall: files are small and
focused, controllers stay thin, TS is strict with zero `any`/`@ts-ignore` in production code, and the riskiest
areas (proposal state machine, tool schema, agent runs) have strong specs. The items below are the concrete
gaps found, ordered so the highest-value work comes first.

## P1 — Confidence in existing behavior

- [ ] **Fix the desktop e2e suite** — `apps/desktop/tests/backend.e2e.test.ts` fails 15 of 17 tests at HEAD
  (`main` @ cf627f3): `ScriptedModel received unexpected streaming call #N; no scripted steps remain`. The
  scripted model fixture in `apps/backend/src/testing/` needs enough steps for the coordinator's turns;
  verified pre-existing (identical failures with and without open changes) in the quality pass.
- [ ] **Enforce backend coverage thresholds** — `apps/backend/jest.config.mjs` sets no `collectCoverage` or
  `coverageThreshold`. Start lenient (e.g. 60% global, 80% for `persistence`, `editor-bridge proposals`,
  `agent-runs` state machine) and raise it.

## P2 — Structure of the two big files

- [ ] **Split `apps/desktop/src/features/assistant/EditorScene.ts` (1,664 lines)** — cohesive today, but a
  change magnet. Extract (a) the command dispatch tables (`isGeometryCommand`, `cageEdit` fan-out),
  (b) measurement + collections + outline APIs into feature modules the class delegates to. Keep
  `executePrepared` (proposal prepare/commit/discard) and lifecycle in the class. Tests exist
  (`EditorScene.prepared`, `.collections`, `.performance`, golden replay); golden fixtures are never
  re-recorded — fix the editor or extend `compare.ts` with a reason if histories diverge.
- [ ] **Split `apps/backend/src/modules/agent-runs/agent-run.processor.ts` (495 lines, largest source)** —
  extract the stream-event mapping and preview building into collaborators; keep the run state machine
  transitions in the processor.

## P3 — Test gaps found in the pass

Backend (36 spec files exist; these areas have none or one):

- [ ] `editor-bridge.service.ts` (210 lines) and `editor-bridge.gateway.ts` (153 lines) — only exercised
  indirectly via `src/testing/desktop-fixture.ts`.
- [ ] `agents/agent.registry.ts` + `agent-runtime.providers.ts` (only the guardrail has a spec).
- [ ] `persistence/database.service.ts` directly (currently behind the in-memory helper).
- [ ] `mcp/` covered in this pass (`mcp.registry.spec.ts`); `blender/` is a deliberate placeholder — test
  when the worker is implemented.

Desktop (90 test files; these features lack any):

- [ ] `features/measurements` — `MeasurementPanel.tsx` (351 lines, ~20 hooks) untested.
- [ ] `features/settings` — `ProviderEditor` (266) and `ControlsSettings` (225) untested.
- [ ] `features/providers` slices; `features/projects` has 1 test for 19 source files.

## P4 — Small consistency cleanups

- [x] ~~Delete unused navigation state~~ — `features/navigation/navigationSlice.ts` was dead (page state
  moved to react-router); removed with its folder.
- [x] ~~Rename `tools/tool.factory.ts`~~ — it only adapts definitions to the Agents SDK
  (`toSdkTool`), so it is now `tool.sdk-adapter.ts`; the DI factory lives in `tools.module.ts`.
- [x] ~~Providers DTOs~~ — moved out of `providers.controller.ts` into `providers/dto/`, matching the
  `sessions` and `projects` modules; added `@ApiProperty` annotations like the other DTO files.
- [x] ~~Thin the providers `test` endpoint~~ — the model-available fallback moved into
  `ProvidersService.testConnection`.
- [x] ~~Raw hex in `pages/Home.tsx`~~ — shadow colors became `--shadow-card-lift`, `--shadow-card-lift-hover`
  and `--shadow-tile-lift` tokens in `styles/index.css` (same values; visual output unchanged).
- [ ] `features/documentation/toolGuide.ts` — split the long single-line entries across lines so edits diff
  cleanly.
- [ ] Decide the fate of the `blender` placeholder: implement the worker or drop the `BLENDER_ENABLED` flag.
- [ ] `src/evals/` and `src/integration/` have no `index.ts` (every other backend folder does; minor).

## Guardrails to honor while doing this work

- Database changes: only append to `persistence/migrations.ts`; never edit an applied version.
- Golden command histories in `features/assistant/golden/` are never re-recorded from current code.
- Tests never call OpenAI; mock the model (`@openai/agents` scripted model / editor simulator).
- Run `pnpm check` plus backend jest (`node --experimental-vm-modules node_modules/jest/bin/jest.js`) and
  desktop vitest before considering any item done.
