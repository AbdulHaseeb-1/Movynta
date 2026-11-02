import {
  BoxGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { benchConfig } from "../config/bench.config";

/** A small, fast, seeded generator (mulberry32), so every run builds the same scene. */
export function seededRandom(seed: number = benchConfig.seed): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_COMMANDS_PER_BATCH = 50;

export function boxCommand(index: number) {
  return {
    commandId: `box-${index}`,
    type: "geometry.create_primitive",
    objectId: `obj_${index}`,
    primitive: "box",
    size: 1,
    replaceExisting: false,
  };
}

export function moveCommand(objectId: string, x: number) {
  return {
    commandId: "move",
    type: "scene.transform_object",
    objectId,
    transform: { position: [x, 0, 0], rotation: [0, 0.5, 0], scale: [1, 1, 1] },
  };
}

export interface BuiltEditor {
  scene: Scene;
  editor: EditorScene;
  /** The id of every object, in creation order. */
  ids: string[];
  /** The next unused proposal id, for tests that keep applying batches. */
  nextProposal: () => string;
}

/** An editor holding `objectCount` boxes, created the way the assistant creates them: in batches of up to 50. */
export function buildEditor(objectCount: number): BuiltEditor {
  const scene = new Scene();
  const editor = new EditorScene(scene, "prj_bench");
  const ids: string[] = [];
  let proposals = 0;
  const nextProposal = () => `bench-${proposals++}`;
  for (let start = 0; start < objectCount; start += MAX_COMMANDS_PER_BATCH) {
    const batch = [];
    for (let index = start; index < Math.min(objectCount, start + MAX_COMMANDS_PER_BATCH); index += 1) {
      batch.push(boxCommand(index));
      ids.push(`obj_${index}`);
    }
    const result = editor.execute(nextProposal(), editor.currentRevision, batch);
    if (result.status !== "applied") throw new Error("The fixture batch was rejected");
  }
  return { scene, editor, ids, nextProposal };
}

/** A model made of `parts` boxes in one flat group, such as an exported scene with many small meshes. */
export function flatModel(parts: number): Group {
  const random = seededRandom();
  const geometry = new BoxGeometry(0.2, 0.2, 0.2);
  const material = new MeshStandardMaterial();
  const model = new Group();
  for (let index = 0; index < parts; index += 1) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set((random() - 0.5) * 10, (random() - 0.5) * 10, (random() - 0.5) * 10);
    model.add(mesh);
  }
  return model;
}

/** One mesh with about `triangles` triangles, not indexed, like most scanned or exported models. */
export function denseMesh(triangles: number): Mesh {
  // An icosphere has 20 * (detail + 1)^2 triangles.
  const detail = Math.max(0, Math.ceil(Math.sqrt(triangles / 20)) - 1);
  return new Mesh(new IcosahedronGeometry(1, detail), new MeshStandardMaterial());
}
