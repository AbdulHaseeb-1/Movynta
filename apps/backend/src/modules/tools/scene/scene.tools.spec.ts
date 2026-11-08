import type { EditorContext } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { buildingObjects, sceneObject, sceneOf } from "../../../testing/scene-fixtures.js";
import { createSceneTools } from "./scene.tools.js";
import type { ToolDefinition } from "../tool.types.js";

const context = { userId: "u", projectId: "p", clientId: "c" } as unknown as AgentRunContext;

function toolsFor(scene: EditorContext) {
  const calls = { context: 0 };
  const bridge = {
    assertConnection: () => undefined,
    getContext: () => {
      calls.context += 1;
      return Promise.resolve(scene);
    },
  } as unknown as EditorBridge;
  const tools = createSceneTools({ bridge, proposals: {} as never });
  const byName = (name: string): ToolDefinition => {
    const found = tools.find((tool) => tool.name === name);
    if (!found) throw new Error(`No tool ${name}`);
    return found;
  };
  return { calls, readBranch: byName("editor.read_branch"), findRepeats: byName("editor.find_repeats"), query: byName("editor.query_objects"), tools };
}

const big = sceneOf(buildingObjects({ floors: 20, columns: 20 }), { selected: ["roof"], revision: 41 });

describe("scene tools", () => {
  it("are read-only tools with provider-friendly names", () => {
    const { tools } = toolsFor(big);
    expect(tools.map((tool) => [tool.name, tool.permission])).toEqual([
      ["editor.read_branch", "read"],
      ["editor.find_repeats", "read"],
      ["editor.query_objects", "read"],
    ]);
  });

  it("read the scene once per call", async () => {
    const { calls, readBranch, findRepeats, query } = toolsFor(big);
    await readBranch.execute({}, context);
    await findRepeats.execute({}, context);
    await query.execute({ nameMatches: "roof" }, context);
    expect(calls.context).toBe(3);
  });
});

describe("editor.read_branch", () => {
  it("returns the scene totals and the top level", async () => {
    const { readBranch } = toolsFor(big);
    const result = (await readBranch.execute({}, context)) as Record<string, unknown>;
    expect(result).toMatchObject({ revision: 41, objectCount: 4 + 400 * 3, countsByType: { empty: 2 + 400, mesh: 2 + 800 }, truncated: false });
    expect(result["unreachable"]).toBeUndefined();
  });

  it("opens a branch by id and refuses an id that is not there, with a way forward", async () => {
    const { readBranch } = toolsFor(big);
    const opened = (await readBranch.execute({ rootId: "facade" }, context)) as { node: { id: string }; children: unknown[] };
    expect(opened.node.id).toBe("facade");
    expect(opened.children).toHaveLength(1);
    await expect(readBranch.execute({ rootId: "nope" }, context)).rejects.toThrow(/rootId "nope" is not in the scene; read the scene with editor.read_branch/);
  });

  it("rejects settings outside their range", () => {
    const { readBranch } = toolsFor(big);
    expect(readBranch.parameters.safeParse({ depth: 5 }).success).toBe(false);
    expect(readBranch.parameters.safeParse({ depth: 0 }).success).toBe(false);
    expect(readBranch.parameters.safeParse({ childLimit: 101 }).success).toBe(false);
    expect(readBranch.parameters.safeParse({ extra: true }).success).toBe(false);
    expect(readBranch.parameters.safeParse({ rootId: "bad id!" }).success).toBe(false);
  });

  it("reads a 1,200-object building in a small fraction of the size of the full context", async () => {
    const { readBranch } = toolsFor(big);
    const tree = JSON.stringify(await readBranch.execute({ rootId: "building", depth: 3 }, context));
    const flat = JSON.stringify(big);
    // The tree has the same information a planner needs; the flat list repeats a transform for every window part.
    expect(tree.length).toBeLessThan(flat.length / 50);
    expect(tree.length).toBeLessThan(2500);
  });

  it("reports damaged scenes instead of failing", async () => {
    const damaged = sceneOf([sceneObject({ id: "a", parentId: "b" }), sceneObject({ id: "b", parentId: "a" }), sceneObject({ id: "ok" })]);
    const { readBranch } = toolsFor(damaged);
    expect(await readBranch.execute({}, context)).toMatchObject({ unreachable: 2, children: [{ id: "ok" }] });
  });
});

describe("editor.find_repeats", () => {
  it("finds the windows of a 20-floor building as one idea", async () => {
    const { findRepeats } = toolsFor(big);
    const result = (await findRepeats.execute({}, context)) as { groups: { name: string; count: number; arrangement: unknown }[]; confidence: string; revision: number };
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ name: "Window", count: 400, arrangement: { kind: "grid", axes: ["x", "y"], counts: [20, 20], steps: [1.2, 3] } });
    expect(result.revision).toBe(41);
    expect(result.confidence).toMatch(/geometry is not compared/);
  });

  it("accepts a smaller group size and a branch, and refuses an unknown branch", async () => {
    const { findRepeats } = toolsFor(big);
    expect(findRepeats.parameters.safeParse({ minCount: 1 }).success).toBe(false);
    expect(findRepeats.parameters.safeParse({ limit: 21 }).success).toBe(false);
    await expect(findRepeats.execute({ rootId: "ghost" }, context)).rejects.toThrow(/rootId "ghost"/);
    expect(await findRepeats.execute({ rootId: "window_0_0", minCount: 2 }, context)).toMatchObject({ groups: [] });
  });
});

describe("editor.query_objects", () => {
  it("selects the windows above a height, in a form the next command can use", async () => {
    const { query } = toolsFor(big);
    const result = (await query.execute({ nameMatches: "window*", position: { y: { min: 30 } }, sortBy: "y", descending: true, limit: 3 }, context)) as {
      total: number;
      matches: { id: string; center: number[] }[];
      hasMore: boolean;
    };
    expect(result.total).toBe(10 * 20);
    expect(result.matches).toHaveLength(3);
    expect(result.matches[0]?.center[1]).toBe(57);
    expect(result.hasMore).toBe(true);
  });

  it("can return only the count", async () => {
    const { query } = toolsFor(big);
    expect(await query.execute({ type: ["empty"], countOnly: true }, context)).toEqual({ revision: 41, total: 402 });
  });

  it("filters on selection", async () => {
    const { query } = toolsFor(big);
    expect(await query.execute({ selected: true }, context)).toMatchObject({ total: 1, matches: [{ id: "roof" }] });
  });

  it("refuses ids that are not in the scene, and malformed filters", async () => {
    const { query } = toolsFor(big);
    await expect(query.execute({ withinId: "ghost" }, context)).rejects.toThrow(/withinId "ghost"/);
    await expect(query.execute({ parentId: "ghost" }, context)).rejects.toThrow(/parentId "ghost"/);
    expect(query.parameters.safeParse({ position: { y: { min: 5, max: 1 } } }).success).toBe(false);
    expect(query.parameters.safeParse({ position: { y: {} } }).success).toBe(false);
    expect(query.parameters.safeParse({ position: { w: { min: 1 } } }).success).toBe(false);
    expect(query.parameters.safeParse({ nameMatches: "" }).success).toBe(false);
    expect(query.parameters.safeParse({ type: ["wall"] }).success).toBe(false);
    expect(query.parameters.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("accepts null to mean the top level", async () => {
    const { query } = toolsFor(big);
    expect(await query.execute({ parentId: null }, context)).toMatchObject({ total: 1, matches: [{ id: "building" }] });
  });
});

describe("speed on a full scene", () => {
  // The editor's snapshot holds at most 2000 objects, so this is the worst case any tool call sees.
  const full = sceneOf(buildingObjects({ floors: 26, columns: 26 }).slice(0, 2000));

  it("answers every tool in well under a second", async () => {
    const { readBranch, findRepeats, query } = toolsFor(full);
    expect(full.objects).toHaveLength(2000);
    const started = performance.now();
    await readBranch.execute({ rootId: "building", depth: 4 }, context);
    await findRepeats.execute({}, context);
    await query.execute({ nameMatches: "*a*", sortBy: "name" }, context);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
