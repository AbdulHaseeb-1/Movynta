/*
 * BENCH: Listing, searching and deleting projects
 * TIER: HIGH
 * SUBJECT: apps/backend/src/modules/projects/projects.repository.ts#list, #view, #conversation, #hasActiveRun, #purge
 *          and apps/backend/src/modules/projects/projects.service.ts#tidyText, #normalizeProjectName
 * MEASURES: latency
 * COMPLEXITY: list O(projects + runs) with an index on agent_runs(project_id); O(projects x runs) without one
 * INPUTS: projects 50..400 with 10 runs each; seed 20260402
 * BASELINE: baselines/backend/projects.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: HTTP, authentication
 * NOTES: the Home page lists projects every time it opens and after every pause in typing in the search box.
 *        Each project row carries two subqueries over its runs, so a missing index shows up as a cost that
 *        grows with the product of the two counts.
 */
import "reflect-metadata";
import { describe, it } from "vitest";
import { ProjectsRepository } from "../../../apps/backend/src/modules/projects/projects.repository";
import { normalizeProjectName, tidyText } from "../../../apps/backend/src/modules/projects/projects.service";
import type { ProjectListQuery } from "../../../apps/backend/src/modules/projects/projects.types";
import { BENCH_USER, openDatabase, seedProjects } from "../../fixtures/backend.fixtures";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

const PROJECT_COUNTS = [50, 100, 200, 400];
const RUNS_PER_PROJECT = 10;

const everything: ProjectListQuery = { search: undefined, category: undefined, scope: "active", starredOnly: false, sort: "updated" };

describe("project library", () => {
  it("lists and searches projects in time linear in what is stored", async () => {
    const cases: BenchCase[] = PROJECT_COUNTS.flatMap((projects) => {
      const database = openDatabase();
      seedProjects(database, projects, RUNS_PER_PROJECT);
      const repository = new ProjectsRepository(database);
      const firstId = `prj_${String(0).padStart(8, "0")}-0000-0000-0000-000000000000`;
      return [
        { name: "list (all)", params: { projects }, run: () => consume(repository.list(BENCH_USER, everything).length) },
        { name: "list (sorted by name)", params: { projects }, run: () => consume(repository.list(BENCH_USER, { ...everything, sort: "name" }).length) },
        { name: "list (search)", params: { projects }, run: () => consume(repository.list(BENCH_USER, { ...everything, search: "object 3-" }).length) },
        { name: "view", params: { projects }, run: () => consume(repository.view(firstId)?.runCount ?? 0) },
        { name: "conversation", params: { projects }, run: () => consume(repository.conversation(firstId).messages.length) },
        { name: "hasActiveRun", params: { projects }, run: () => consume(repository.hasActiveRun(firstId) ? 1 : 0) },
      ];
    });
    const results = await measureCases(cases);
    const claim = (name: string, declared: number) => ({ key: "projects", declared, label: name, where: (result: { name: string }) => result.name === name });
    finishWithGrowth("backend/projects.list", results, [
      // The listing is linear in the projects, but the curve bends once between 50 and 100 projects (the
      // smallest library is read entirely from cache) and then flattens, so the tolerance is wider.
      { ...claim("list (all)", 1), tolerance: 0.7 },
      { ...claim("list (sorted by name)", 1), tolerance: 0.7 },
      { ...claim("list (search)", 1), tolerance: 0.7 },
      // Each of these reads one project's runs, which must not depend on how many other projects there are.
      { ...claim("view", 0), tolerance: 0.6 },
      { ...claim("conversation", 0), tolerance: 0.6 },
      { ...claim("hasActiveRun", 0), tolerance: 0.6 },
    ]);
  });

  it("deletes a project in time that does not depend on the library", async () => {
    const cases: BenchCase[] = PROJECT_COUNTS.map((projects) => {
      const database = openDatabase();
      seedProjects(database, projects, RUNS_PER_PROJECT);
      const repository = new ProjectsRepository(database);
      let next = 0;
      return {
        name: "purge",
        params: { projects },
        run: () => {
          // Each iteration removes a different project; the library shrinks slowly enough not to matter.
          const id = `prj_${String(next % projects).padStart(8, "0")}-0000-0000-0000-000000000000`;
          next += 1;
          repository.purge(id);
        },
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("backend/projects.purge", results, [{ key: "projects", declared: 0, tolerance: 0.6 }]);
  });

  it("tidies names", async () => {
    const results = await measureCases([
      { name: "tidyText", params: { chars: 24 }, run: () => consume(tidyText("  Robot \n\t  head  v2 ").length) },
      { name: "normalizeProjectName", params: { chars: 24 }, run: () => consume(normalizeProjectName("  Pine   tree  ").length) },
    ]);
    finishWithGrowth("backend/projects.names", results, []);
  });
});
