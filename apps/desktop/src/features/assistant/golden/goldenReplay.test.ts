import { beforeAll, describe, expect, it } from "vitest";
import { Scene } from "three";
import { z } from "zod";
import { EditorScene, type SceneStep } from "../EditorScene";
import { ensureManifold } from "../../meshGeometry/meshBoolean";
import { SCENARIOS, buildModel, compareSummaries, recordScenario, summarize, type SceneSummary } from "./index";

/**
 * Histories saved by older code must still replay into the same scene. Each fixture is a history recorded by the
 * editor of an earlier commit (see README.md), with the scene that editor made from it. Today's editor replays the
 * history and the two scenes must agree, except where a difference is written down in `compare.ts`.
 */
const summarySchema = z.object({
  revision: z.number(),
  objects: z.array(z.object({
    id: z.string(), name: z.string(), type: z.string(), parentId: z.string().nullable(), visible: z.boolean(),
    position: z.array(z.number()), rotation: z.array(z.number()), scale: z.array(z.number()), bounds: z.array(z.number()).nullable(),
  })),
  meshes: z.array(z.object({
    objectId: z.string(), ordinal: z.number(), name: z.string(), visible: z.boolean(), vertices: z.number(), triangles: z.number(),
    geometry: z.string(), world: z.string(), modifiers: z.array(z.unknown()),
  })),
});
const fixtureSchema = z.object({
  meta: z.object({ set: z.string(), commit: z.string(), scenario: z.string(), description: z.string() }),
  steps: z.array(z.unknown()),
  expected: summarySchema,
});
const files = import.meta.glob("./fixtures/*/*.json", { eager: true, import: "default" });
const fixtures = Object.entries(files).map(([path, raw]) => ({ path, fixture: fixtureSchema.parse(raw), raw }));

function stepsOf(raw: unknown): SceneStep[] {
  // The steps are what a project stores; the editor reads them with its own schemas, so only their shape is checked here.
  return z.array(z.union([
    z.object({ kind: z.literal("commands"), proposalId: z.string(), commands: z.unknown() }),
    z.object({ kind: z.literal("import"), assetId: z.string(), objectId: z.string(), name: z.string(), format: z.enum(["glb", "gltf", "obj", "fbx", "stl"]).or(z.string()) }),
  ])).parse(raw);
}

async function replay(steps: SceneStep[]): Promise<SceneSummary> {
  const editor = new EditorScene(new Scene(), "golden");
  await editor.restore(steps, async (step) => buildModel(step.assetId));
  return summarize(editor);
}

beforeAll(async () => {
  await ensureManifold();
});

describe("golden histories", () => {
  it("has a fixture for every scenario in every recorded set", () => {
    const sets = new Set(fixtures.map(({ fixture }) => fixture.meta.set));
    expect(sets.size).toBeGreaterThan(0);
    for (const set of sets) {
      const names = fixtures.filter(({ fixture }) => fixture.meta.set === set).map(({ fixture }) => fixture.meta.scenario).sort();
      expect(names, set).toEqual(Object.keys(SCENARIOS).sort());
    }
  });

  describe.each(fixtures)("$path", ({ fixture }) => {
    it("replays into the scene it was saved with", async () => {
      const actual = await replay(stepsOf(fixture.steps));
      expect(compareSummaries(fixture.expected, actual)).toEqual([]);
    });

    it("is not trivial", () => {
      expect(fixture.steps.length).toBeGreaterThan(1);
      expect(fixture.expected.meshes.length).toBeGreaterThan(0);
    });
  });

  it("is told apart from a scene that really differs", async () => {
    const [first] = fixtures.filter(({ fixture }) => fixture.meta.scenario === "figure");
    if (!first) throw new Error("No figure fixture");
    const actual = await replay(stepsOf(first.fixture.steps));
    const expected = first.fixture.expected;
    const moved = structuredClone(actual);
    const object = moved.objects[0];
    if (!object) throw new Error("No objects");
    object.position = [object.position[0] ?? 0, (object.position[1] ?? 0) + 0.01, object.position[2] ?? 0];
    expect(compareSummaries(expected, moved)).not.toEqual([]);
    const renamed = structuredClone(actual);
    const unique = renamed.objects.find((entry) => entry.id === "head");
    if (!unique) throw new Error("No head");
    unique.name = "Skull";
    expect(compareSummaries(expected, renamed)).not.toEqual([]);
    const reshaped = structuredClone(actual);
    const mesh = reshaped.meshes[0];
    if (!mesh) throw new Error("No meshes");
    mesh.geometry = "00000000";
    expect(compareSummaries(expected, reshaped)).not.toEqual([]);
    const later = structuredClone(actual);
    later.revision += 1;
    expect(compareSummaries(expected, later)).not.toEqual([]);
  });

  it("allows the documented renumbering of duplicate names, and only that", async () => {
    const entry = fixtures.find(({ fixture }) => fixture.meta.scenario === "duplicates");
    if (!entry) throw new Error("No duplicates fixture");
    const actual = await replay(stepsOf(entry.fixture.steps));
    const holder = actual.objects.filter((object) => object.parentId === "holder").map((object) => object.name).sort();
    expect(holder).toEqual(["Part", "Part.001", "Part.002"]);
    const clash = structuredClone(actual);
    for (const object of clash.objects) if (object.parentId === "holder") object.name = "Part";
    expect(compareSummaries(entry.fixture.expected, clash)).not.toEqual([]);
  });

  it("makes today's editor produce the same steps the fixtures hold", () => {
    // If this fails, today's recorder stores something other than what the old code stored: the fixtures no longer test what projects hold.
    for (const { fixture } of fixtures) {
      const scenario = SCENARIOS[fixture.meta.scenario];
      if (!scenario) throw new Error(`Unknown scenario ${fixture.meta.scenario}`);
      expect(JSON.parse(JSON.stringify(recordScenario(scenario).steps)), fixture.meta.scenario).toEqual(fixture.steps);
    }
  });

  it("makes the same scene when today's editor runs the scenario live", () => {
    for (const { fixture } of fixtures) {
      const scenario = SCENARIOS[fixture.meta.scenario];
      if (!scenario) throw new Error(`Unknown scenario ${fixture.meta.scenario}`);
      expect(compareSummaries(fixture.expected, recordScenario(scenario).summary), fixture.meta.scenario).toEqual([]);
    }
  });
});
