/*
 * BENCH: Recording and reading a project's scene history
 * TIER: HIGH
 * SUBJECT: apps/backend/src/modules/projects/project-scenes.service.ts#append, #list, #existingObjectIds, #copy, #addImport, #asset
 *          and projects.service.ts#recordSceneEdit
 * MEASURES: latency
 * COMPLEXITY: append O(1); recordSceneEdit O(1) in the length of the history; list and copy O(history)
 * INPUTS: history 250..4000 steps with 100 objects; model files 1..32 MB; seed 20260402
 * BASELINE: baselines/backend/scenes.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: HTTP, authentication, JSON parsing of the request body
 * NOTES: recordSceneEdit runs when the user finishes dragging an object, so it must not slow down as a project
 *        gets worked on. The database is in memory, so disk speed is not measured.
 */
import "reflect-metadata";
import { describe, it } from "vitest";
import { ProjectScenesService } from "../../../apps/backend/src/modules/projects/project-scenes.service";
import { ProjectsRepository } from "../../../apps/backend/src/modules/projects/projects.repository";
import { ProjectsService } from "../../../apps/backend/src/modules/projects/projects.service";
import { BENCH_USER, openDatabase, seedHistory } from "../../fixtures/backend.fixtures";
import { moveCommand, seededRandom } from "../../fixtures/scene.fixtures";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

const HISTORY_STEPS = [250, 500, 1000, 2000, 4000];
const FILE_SIZES_MB = [1, 4, 16, 32];

describe("scene history", () => {
  it("records a user edit in time that does not depend on the history", async () => {
    const database = openDatabase();
    const projects = new ProjectsService(new ProjectsRepository(database), new ProjectScenesService(database));
    const random = seededRandom();
    const cases: BenchCase[] = HISTORY_STEPS.map((steps) => {
      const { projectId } = seedHistory(database, steps);
      return {
        name: "recordSceneEdit",
        params: { steps },
        run: () => consume(projects.recordSceneEdit(BENCH_USER, projectId, [moveCommand(`obj_${Math.floor(random() * 100)}`, random())]).proposalId.length),
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("backend/scenes.record", results, [{ key: "steps", declared: 0, tolerance: 0.4 }]);
  });

  it("appends a step in constant time and reads the whole history in linear time", async () => {
    const database = openDatabase();
    const random = seededRandom();
    const cases: BenchCase[] = HISTORY_STEPS.flatMap((steps) => {
      const { projectId, scenes } = seedHistory(database, steps);
      return [
        {
          name: "append",
          params: { steps },
          run: () => scenes.append(projectId, "bench", [moveCommand(`obj_${Math.floor(random() * 100)}`, random())] as never),
        },
        { name: "list", params: { steps }, run: () => consume(scenes.list(projectId).length) },
        {
          name: "existingObjectIds (50 ids)",
          params: { steps },
          run: () => consume(scenes.existingObjectIds(projectId, Array.from({ length: 50 }, (_, index) => `obj_${index}`)).size),
        },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("backend/scenes.history", results, [
      { key: "steps", declared: 0, label: "append", where: (result) => result.name === "append", tolerance: 0.4 },
      { key: "steps", declared: 1, label: "list", where: (result) => result.name === "list" },
      { key: "steps", declared: 0, label: "existingObjectIds", where: (result) => result.name.startsWith("existingObjectIds"), tolerance: 0.4 },
    ]);
  });

  it("copies a history and keeps imported models in time linear in what is copied", async () => {
    const database = openDatabase();
    const cases: BenchCase[] = HISTORY_STEPS.slice(0, 4).map((steps) => {
      const { projectId, scenes } = seedHistory(database, steps);
      let copies = 0;
      return {
        name: "copy",
        params: { steps },
        run: () => {
          copies += 1;
          const target = `prj_copy-${steps}-${copies}`;
          database.db
            .prepare("INSERT INTO projects (id, user_id, name, category, starred, created_at, updated_at) VALUES (?, ?, '', 'design', 0, ?, ?)")
            .run(target, BENCH_USER, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
          scenes.copy(projectId, target);
        },
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("backend/scenes.copy", results, [{ key: "steps", declared: 1 }]);
  });

  it("stores and reads model files in time linear in their size", async () => {
    const database = openDatabase();
    const scenes = new ProjectScenesService(database);
    const cases: BenchCase[] = FILE_SIZES_MB.flatMap((megabytes) => {
      const projectId = `prj_files-${megabytes}`;
      database.db
        .prepare("INSERT INTO projects (id, user_id, name, category, starred, created_at, updated_at) VALUES (?, ?, '', 'design', 0, ?, ?)")
        .run(projectId, BENCH_USER, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
      const content = new Uint8Array(megabytes * 1024 * 1024).fill(7);
      let count = 0;
      const first = scenes.addImport(projectId, { objectId: "seed_model", name: "seed.glb", format: "glb", content });
      return [
        {
          name: "addImport",
          params: { megabytes },
          // The project holds at most 256 MB, so older copies are removed outside the timed region.
          prepare: () => database.db.prepare("DELETE FROM project_assets WHERE project_id = ? AND object_id != 'seed_model'").run(projectId),
          run: () => {
            count += 1;
            consume(scenes.addImport(projectId, { objectId: `model_${count}`, name: "robot.glb", format: "glb", content }).assetId.length);
          },
        },
        { name: "asset (read)", params: { megabytes }, run: () => consume(scenes.asset(projectId, first.assetId).content.byteLength) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("backend/scenes.files", results, [
      { key: "megabytes", declared: 1, label: "addImport", where: (result) => result.name === "addImport", tolerance: 0.5 },
      { key: "megabytes", declared: 1, label: "asset", where: (result) => result.name === "asset (read)", tolerance: 0.5 },
    ]);
  });
});
