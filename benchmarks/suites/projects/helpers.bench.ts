/*
 * BENCH: The projects feature's pure helpers and store, and the chat restore
 * TIER: MEDIUM
 * SUBJECT: apps/desktop/src/features/projects (listQuery, formatRelativeTime, displayName, projectsReducer)
 *          and apps/desktop/src/features/assistant/conversationMessages.ts#savedExchangesToMessages
 * MEASURES: latency
 * COMPLEXITY: the list-wide functions are O(projects) or O(messages); the rest are O(1)
 * INPUTS: projects 100..1600; saved messages 100..1600; seed 20260402
 * BASELINE: baselines/projects/helpers.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: React rendering, network
 * NOTES: formatRelativeTime runs once per project card on every render of the Home page.
 */
import { describe, it } from "vitest";
import { savedExchangesToMessages, type SavedExchange } from "@/features/assistant/conversationMessages";
import { formatRelativeTime } from "@/features/projects/formatRelativeTime";
import { displayName, isUntitled } from "@/features/projects/projectName";
import { listQuery } from "@/features/projects/projectsApi";
import { projectChanged, projectRemoved, projectsLoaded, projectsReducer } from "@/features/projects/projectsSlice";
import { defaultProjectFilters, type Project } from "@/features/projects/projectTypes";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

const COUNTS = [100, 200, 400, 800, 1600];
const NOW = Date.parse("2026-11-02T12:00:00.000Z");

function project(index: number): Project {
  return {
    id: `prj_${index}`,
    name: index % 2 === 0 ? `Project ${index}` : "",
    category: "design",
    starred: index % 5 === 0,
    archived: false,
    createdAt: new Date(NOW - index * 60_000).toISOString(),
    updatedAt: new Date(NOW - index * 30_000).toISOString(),
    runCount: index % 7,
    firstPrompt: "A low-poly pine tree built from cylinders and spheres",
  };
}

function exchange(index: number): SavedExchange {
  return {
    runId: `run_${index}`,
    prompt: `Request number ${index}`,
    reply: "Done. The scene now holds the requested objects and they are ready to review.",
    status: "completed",
    createdAt: new Date(NOW - index * 1000).toISOString(),
  };
}

describe("projects helpers", () => {
  it("rebuilds a chat and updates the store in time linear in their size", async () => {
    const cases: BenchCase[] = COUNTS.flatMap((count) => {
      const exchanges = Array.from({ length: count }, (_, index) => exchange(index));
      const projects = Array.from({ length: count }, (_, index) => project(index));
      const loaded = projectsReducer(undefined, projectsLoaded(projects));
      return [
        { name: "savedExchangesToMessages", params: { count }, run: () => consume(savedExchangesToMessages(exchanges).length) },
        { name: "projectsLoaded", params: { count }, run: () => consume(projectsReducer(undefined, projectsLoaded(projects)).items.length) },
        { name: "projectChanged", params: { count }, run: () => consume(projectsReducer(loaded, projectChanged({ ...project(count - 1), name: "Renamed" })).items.length) },
        { name: "projectRemoved", params: { count }, run: () => consume(projectsReducer(loaded, projectRemoved(`prj_${count - 1}`)).items.length) },
      ];
    });
    const results = await measureCases(cases);
    // These copy an array of a few hundred microseconds at most; the first doublings are steeper while the
    // arrays outgrow the young generation of the garbage collector, so the tolerance is wider than usual.
    const claim = (name: string) => ({
      key: "count",
      declared: 1,
      tolerance: 0.7,
      label: name,
      where: (result: { name: string }) => result.name === name,
    });
    finishWithGrowth("projects/helpers.lists", results, [
      claim("savedExchangesToMessages"),
      claim("projectsLoaded"),
      claim("projectChanged"),
      claim("projectRemoved"),
    ]);
  });

  it("formats one card's text in constant time", async () => {
    const sample = project(3);
    const results = await measureCases([
      { name: "formatRelativeTime (minutes)", params: { calls: 1 }, run: () => consume(formatRelativeTime(sample.updatedAt, NOW).length) },
      { name: "formatRelativeTime (date)", params: { calls: 1 }, run: () => consume(formatRelativeTime("2025-03-04T10:00:00.000Z", NOW).length) },
      { name: "displayName + isUntitled", params: { calls: 1 }, run: () => consume(displayName(sample).length + (isUntitled(sample) ? 1 : 0)) },
      { name: "listQuery", params: { calls: 1 }, run: () => consume(listQuery({ ...defaultProjectFilters, search: "pine tree", view: "starred", category: "design", sort: "name" }).length) },
    ]);
    finishWithGrowth("projects/helpers.card", results, []);
  });
});
