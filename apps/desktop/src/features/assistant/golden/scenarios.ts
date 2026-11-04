import { Scene } from "three";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import { EditorScene, type SceneStep } from "../EditorScene";
import { edgeKey } from "../../meshGeometry/meshTopology";
import { buildModel, type ModelRecipe } from "./models";
import { summarize, type SceneSummary } from "./summary";

/**
 * Histories that exercise what the editor could do before shapes had parents and names of their own, collections,
 * relative moves and part names. Each is a list of steps the way a project stores them, and a scene to compare with.
 * They use only the commands of that time, so the same scenario can be run by the editor of then and the editor of now.
 */
export interface Recorder {
  readonly editor: EditorScene;
  /** Applies a batch and stores it as a step. A batch that is refused stops the scenario. */
  batch(commands: readonly unknown[]): void;
  importModel(objectId: string, recipe: ModelRecipe): void;
  /** The ids of the edges that only one face has, in the base cage of a mesh. */
  boundaryEdges(objectId: string): string[];
  /** The ids of the faces of a mesh whose normal points along `normal`. */
  facesFacing(objectId: string, normal: readonly [number, number, number]): string[];
}
export interface Scenario {
  description: string;
  run(recorder: Recorder): void;
}
export interface Recorded {
  steps: SceneStep[];
  summary: SceneSummary;
}

const prim = (objectId: string, primitive: string, size: number, options?: Record<string, number>) => ({
  commandId: `make_${objectId}`, type: "geometry.create_primitive", objectId, primitive, size, ...(options ? { options } : {}),
});
const place = (objectId: string, position: number[], rotation?: number[], scale?: number[]) => ({
  commandId: `place_${objectId}`, type: "scene.transform_object", objectId,
  transform: { position, ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}) },
});
const group = (objectId: string, name: string) => ({ commandId: `group_${objectId}`, type: "scene.create_object", objectId, name });
const adopt = (objectId: string, parentId: string | null) => ({ commandId: `adopt_${objectId}`, type: "scene.set_parent", objectId, parentId });
const rename = (objectId: string, name: string) => ({ commandId: `rename_${objectId}`, type: "scene.rename_object", objectId, name });
const show = (objectId: string, visible: boolean) => ({ commandId: `show_${objectId}_${visible}`, type: "scene.set_visibility", objectId, visible });
const remove = (objectId: string) => ({ commandId: `remove_${objectId}`, type: "scene.delete_object", objectId });
const cut = (commandId: string, objectId: string, operandObjectId: string, operandMeshPath: (number | string)[] = []) => ({
  commandId, type: "geometry.boolean", objectId, operandObjectId, operandMeshPath,
});

export const SCENARIOS: Record<string, Scenario> = {
  figure: {
    description: "A figure built the way the assistant built one before: flat parts placed one by one, then parented, renamed and hidden.",
    run(r) {
      r.batch([
        group("figure", "Figure"),
        prim("torso", "box", 2, { width: 1.2, height: 2, depth: 0.6 }),
        prim("head", "sphere", 1, { radius: 0.5, widthSegments: 12, heightSegments: 8 }),
        prim("armL", "cylinder", 1, { radiusTop: 0.2, radiusBottom: 0.25, height: 1.5, radialSegments: 12 }),
        prim("armR", "cylinder", 1, { radiusTop: 0.2, radiusBottom: 0.25, height: 1.5, radialSegments: 12 }),
        place("torso", [0, 1, 0]), place("head", [0, 2.4, 0]), place("armL", [-0.9, 1.2, 0], [0, 0, 0.2]), place("armR", [0.9, 1.2, 0], [0, 0, -0.2]),
      ]);
      r.batch([adopt("torso", "figure"), adopt("head", "figure"), adopt("armL", "torso"), adopt("armR", "torso"), place("figure", [3, 0, 1], [0, 0.5, 0], [1.5, 1.5, 1.5])]);
      r.batch([rename("head", "Head"), rename("torso", "Torso"), show("armR", false)]);
      r.batch([prim("crate1", "box", 1), prim("crate2", "box", 1), place("crate1", [-4, 0.5, 0]), place("crate2", [-6, 0.5, 0])]);
      r.batch([rename("crate1", "Crate"), group("crate", "Crate"), remove("crate2")]);
      r.batch([adopt("armL", null), place("armL", [0, 3, 0])]);
    },
  },

  modifiers: {
    description: "Live modifier stacks: bevel and subdivision added one by one, then replaced, disabled and cleared.",
    run(r) {
      r.batch([prim("block", "box", 2), prim("ball", "icosahedron", 1.5), place("ball", [4, 0, 0])]);
      r.batch([
        { commandId: "bevel", type: "geometry.bevel", objectId: "block", width: 0.15, segments: 3, profile: "circular" },
        { commandId: "smooth", type: "geometry.subdivide", objectId: "block", levels: 1, method: "catmull-clark" },
        { commandId: "loop", type: "geometry.subdivide", objectId: "ball", levels: 1, method: "loop" },
      ]);
      r.batch([{
        commandId: "stack", type: "geometry.set_modifiers", objectId: "block",
        modifiers: [
          { id: "b", kind: "bevel", enabled: true, width: 0.1, segments: 2, profile: "round" },
          { id: "s", kind: "subdivision", enabled: false, levels: 2, method: "catmull-clark" },
        ],
      }]);
      r.batch([place("block", [0, 1, 0], [0.2, 0.4, 0])]);
      r.batch([{ commandId: "clear", type: "geometry.set_modifiers", objectId: "block", modifiers: [] }]);
      r.batch([{ commandId: "again", type: "geometry.subdivide", objectId: "ball", levels: 1, method: "linear" }]);
    },
  },

  booleans: {
    description: "Cuts made with other scene objects, moved afterwards so the cut is worked out again, and a cut that uses a part of an imported model by index.",
    run(r) {
      r.batch([prim("wall", "box", 2), prim("cut1", "box", 1), prim("cut2", "cylinder", 1.2), place("cut1", [1, 1, 1]), place("cut2", [-1, 1, -1])]);
      r.batch([cut("cutter", "wall", "cut1"), { commandId: "round", type: "geometry.bevel", objectId: "wall", width: 0.05, segments: 2 }]);
      r.batch([{
        commandId: "both", type: "geometry.set_modifiers", objectId: "wall",
        modifiers: [
          { id: "m1", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "cut1", operandMeshPath: [] },
          { id: "m2", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "cut2", operandMeshPath: [] },
        ],
      }]);
      r.batch([place("cut2", [-1, -1, 1])]);
      r.batch([place("wall", [2, 0, 0], [0, 0.3, 0])]);
      r.batch([show("cut1", false)]);
      r.importModel("model", "robot");
      r.batch([prim("target", "box", 1)]);
      r.batch([{
        commandId: "withpart", type: "geometry.set_modifiers", objectId: "target",
        modifiers: [{ id: "cut", kind: "boolean", enabled: true, operation: "difference", operandObjectId: "model", operandMeshPath: [1] }],
      }]);
      r.batch([place("target", [0.02, 0, 0])]);
      r.batch([place("model", [0, 0, 0], [0, 0, 0])]);
    },
  },

  faces: {
    description: "Edits to faces: an extrusion, a move and scale of the new cap, subdividing some faces, and filling the hole of an open box.",
    run(r) {
      r.batch([prim("slab", "box", 2)]);
      r.batch([{ commandId: "pull", type: "geometry.extrude", objectId: "slab", kind: "face", ids: r.facesFacing("slab", [0, 1, 0]), normalDistance: 1 }]);
      r.batch([{
        commandId: "shape", type: "geometry.transform_faces", objectId: "slab", ids: r.facesFacing("slab", [0, 1, 0]),
        space: "local", transform: { position: [0, 0.2, 0], scale: [0.8, 0.8, 0.8] },
      }]);
      r.batch([{ commandId: "split", type: "geometry.subdivide_faces", objectId: "slab", ids: r.facesFacing("slab", [1, 0, 0]) }]);
      r.batch([prim("sheet", "plane", 2), place("sheet", [5, 0, 0])]);
      r.batch([{ commandId: "open", type: "geometry.extrude", objectId: "sheet", kind: "face", ids: ["0"], normalDistance: 1 }]);
      r.batch([{ commandId: "close", type: "geometry.fill_hole", objectId: "sheet", ids: r.boundaryEdges("sheet") }]);
    },
  },

  imported: {
    description: "An imported model with a shape put under it, which moves its parts to other positions, edited by index before and after.",
    run(r) {
      r.importModel("model", "robot");
      r.batch([place("model", [0, 2, 0], [0, 0.4, 0])]);
      r.batch([prim("hat", "box", 0.5)]);
      r.batch([adopt("hat", "model")]);
      r.batch([{ commandId: "arm", type: "geometry.subdivide", objectId: "model", meshPath: [3], levels: 1, method: "linear" }]);
      r.batch([{ commandId: "edge", type: "geometry.bevel", objectId: "model", meshPath: [2], width: 0.05, segments: 2 }]);
      r.batch([rename("hat", "Hat"), show("model", false)]);
      r.batch([remove("hat")]);
      r.batch([{ commandId: "head", type: "geometry.subdivide", objectId: "model", meshPath: [0], levels: 1, method: "linear" }]);
      r.importModel("copy", "plain");
      r.batch([place("copy", [10, 0, 0])]);
    },
  },

  custom: {
    description: "A custom polygon mesh, extruded, then given a live bevel.",
    run(r) {
      const vertices = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
      const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      r.batch([{ commandId: "mesh", type: "geometry.create_mesh", objectId: "custom", name: "Custom", vertices, faces }]);
      r.batch([place("custom", [0, 1, 0], [0, 0.6, 0])]);
      r.batch([{ commandId: "out", type: "geometry.extrude", objectId: "custom", kind: "face", ids: ["1"], normalDistance: 0.5 }]);
      r.batch([{ commandId: "soften", type: "geometry.bevel", objectId: "custom", width: 0.08, segments: 2 }]);
    },
  },

  duplicates: {
    description: "Objects that share a name under one parent, which the editor of the time allowed and today's numbers (Part, Part.001).",
    run(r) {
      r.batch([prim("a", "box", 1), prim("b", "box", 1), prim("c", "box", 1), group("g1", "Group"), group("g2", "Group")]);
      r.batch([rename("a", "Part"), rename("b", "Part"), rename("c", "Part"), place("b", [2, 0, 0]), place("c", [4, 0, 0])]);
      r.batch([group("holder", "Holder"), adopt("a", "holder"), adopt("b", "holder"), adopt("c", "holder")]);
      r.batch([group("p1", "Left"), group("p2", "Right"), prim("x", "box", 1), prim("y", "box", 1), adopt("x", "p1"), adopt("y", "p2")]);
      r.batch([rename("x", "Leg"), rename("y", "Leg")]);
      // Both are called Leg under their own parents; moving one under the other's parent makes two siblings with one name.
      r.batch([adopt("y", "p1")]);
      r.importModel("m1", "robot");
      r.importModel("m2", "robot");
    },
  },
};

/** Runs a scenario on a new editor, storing each batch and import as a step the way a project does. */
export function recordScenario(scenario: Scenario): Recorded {
  const editor = new EditorScene(new Scene(), "golden");
  const steps: SceneStep[] = [];
  const inspect = (objectId: string, extra: object = {}) =>
    editor.context({ objectId, meshPath: [], offset: 0, limit: 100, view: "base", ...extra }).meshInspection;
  const recorder: Recorder = {
    editor,
    batch(commands) {
      // What a project stores is the commands after the schema has filled in its defaults.
      const stored = editorCommandListSchema.parse(commands);
      const proposalId = `golden_${steps.length + 1}`;
      const result = editor.execute(proposalId, editor.currentRevision, stored);
      if (result.status !== "applied") throw new Error(`A batch of the scenario was refused: ${JSON.stringify(result)}`);
      steps.push({ kind: "commands", proposalId, commands: stored });
    },
    importModel(objectId, recipe) {
      editor.importObject(objectId, buildModel(recipe));
      steps.push({ kind: "import", assetId: recipe, objectId, name: `${recipe}.glb`, format: "glb" });
    },
    boundaryEdges(objectId) {
      const edges = inspect(objectId)?.edges ?? [];
      return edges.filter((edge) => edge.faces.length === 1).map((edge) => edgeKey(edge.vertices[0] ?? 0, edge.vertices[1] ?? 0));
    },
    facesFacing(objectId, normal) {
      return inspect(objectId, { faceQuery: { normal: [...normal], minDot: 0.99 } })?.faceMatches?.ids ?? [];
    },
  };
  scenario.run(recorder);
  return { steps, summary: summarize(editor) };
}
