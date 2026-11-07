import { type Mesh, type BufferGeometry, type Object3D } from "three";
import type { EditorScene } from "../EditorScene";
import { modifierStack } from "../../meshGeometry/modifierStack";
import { isMesh } from "@/lib/three";

/**
 * What a scene is, written so that two scenes can be compared: the objects and their places, and every mesh with a
 * fingerprint of its geometry and where it is. It uses only what both the editor of the past and today's have, since the
 * same function describes a scene made by either. Numbers are rounded to 5 places so that rounding noise is not a
 * difference, and nothing in it depends on an object's identity.
 */
export interface ObjectSummary {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  visible: boolean;
  position: number[];
  rotation: number[];
  scale: number[];
  bounds: number[] | null;
}
export interface MeshSummary {
  objectId: string;
  /** Position of the mesh among the meshes of its object, parts of an imported model included. */
  ordinal: number;
  name: string;
  visible: boolean;
  vertices: number;
  triangles: number;
  geometry: string;
  world: string;
  modifiers: unknown[];
}
export interface SceneSummary {
  revision: number;
  objects: ObjectSummary[];
  meshes: MeshSummary[];
}

const round = (value: number): number => {
  const rounded = Math.round(value * 1e5) / 1e5;
  return rounded === 0 ? 0 : rounded;
};
const roundAll = (values: readonly number[]): number[] => values.map(round);

/** A short fingerprint of a list of numbers, after rounding (FNV-1a). */
function fingerprint(values: ArrayLike<number>): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < values.length; i += 1) {
    hash ^= Math.round((values[i] ?? 0) * 1e5) | 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}


/** Every mesh in an object, the object itself first, then its children in order. */
function meshesOf(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  const visit = (node: Object3D) => {
    if (isMesh(node)) found.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return found;
}

/** Follows a mesh path by child index or by part name, whichever the path uses. Written here so that it does not depend on the editor's. */
function follow(root: Object3D, path: readonly (number | string)[]): Object3D | undefined {
  let node: Object3D | undefined = root;
  for (const step of path) {
    if (!node) return undefined;
    if (typeof step === "number") {
      node = node.children[step];
      continue;
    }
    const match = /^(.*)#(\d+)$/.exec(step);
    const name = match ? (match[1] ?? "") : step;
    const ordinal = match ? Number(match[2]) : 0;
    node = node.children.filter((child) => child.name === name)[ordinal];
  }
  return node;
}

function geometryFingerprint(geometry: BufferGeometry): { vertices: number; triangles: number; geometry: string } {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  return {
    vertices: position.count,
    triangles: (index ? index.count : position.count) / 3,
    geometry: `${fingerprint(position.array)}/${index ? fingerprint(index.array) : "none"}`,
  };
}

interface Spec {
  kind: string;
  operandObjectId?: string;
  operandMeshPath?: readonly (number | string)[];
}

/**
 * A modifier as it is, except that a Boolean's operand is named by which mesh it leads to and not by how the path is
 * written, so that an operand written by index and one written by name that lead to the same mesh are the same.
 */
function describeModifier(editor: EditorScene, spec: Spec): unknown {
  if (spec.kind !== "boolean") return spec;
  const { operandMeshPath, ...rest } = spec;
  const root = spec.operandObjectId === undefined ? undefined : editor.getObject(spec.operandObjectId);
  const target = root && operandMeshPath ? follow(root, operandMeshPath) : undefined;
  const operandPart = root && isMesh(target) ? meshesOf(root).indexOf(target) : -1;
  return { ...rest, operandPart };
}

export function summarize(editor: EditorScene): SceneSummary {
  const objects: ObjectSummary[] = editor.context().objects.map((object) => ({
    id: object.id,
    name: object.name,
    type: object.type,
    parentId: object.parentId,
    visible: object.visible ?? true,
    position: roundAll(object.transform.position),
    rotation: roundAll(object.transform.rotation),
    scale: roundAll(object.transform.scale),
    bounds: object.worldBounds ? roundAll([...object.worldBounds.min, ...object.worldBounds.max]) : null,
  }));
  const meshes: MeshSummary[] = [];
  for (const [objectId, root] of editor.entries()) {
    root.updateWorldMatrix(true, true);
    meshesOf(root).forEach((mesh, ordinal) => {
      const stack = modifierStack(mesh);
      meshes.push({
        objectId,
        ordinal,
        name: mesh.name,
        visible: mesh.visible,
        ...geometryFingerprint(mesh.geometry),
        world: fingerprint(mesh.matrixWorld.elements),
        modifiers: (stack?.modifiers ?? []).map((spec) => describeModifier(editor, spec)),
      });
    });
  }
  return { revision: editor.currentRevision, objects, meshes };
}
