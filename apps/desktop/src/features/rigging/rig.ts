import { Bone, SkinnedMesh, type Object3D } from "three";
import type { ObjectTransform } from "@/features/assistant/EditorScene";

/**
 * The bones of an imported model, in a fixed order. A bone is named by its position in {@link Rig.bones},
 * which depends only on the model file, so a saved pose finds the same bone whenever it is replayed.
 */
export interface Rig {
  /** The object the bones were found under: the imported model. */
  readonly root: Object3D;
  /** Every bone, parents before their children (depth-first, in the order the file lists them). */
  readonly bones: readonly Bone[];
  /** The index of each bone's closest ancestor bone, or -1 for a bone at the top of the hierarchy. */
  readonly parents: Int32Array;
  /** How many bones lie above each bone, for showing the hierarchy as a tree. */
  readonly depths: Uint16Array;
  /** Each bone's transform when the model was imported, to put a bone back where it started. */
  readonly rest: readonly ObjectTransform[];
  /** The meshes the bones deform. */
  readonly skinned: readonly SkinnedMesh[];
}

// `instanceof` narrows these generic classes to `<any>`, so typed predicates keep the types strict.
function isBone(node: Object3D): node is Bone {
  return node instanceof Bone;
}

/** Whether a part of a model is a mesh deformed by a skeleton. */
export function isSkinnedMesh(node: Object3D): node is SkinnedMesh {
  return node instanceof SkinnedMesh;
}

/** Rigs by model. `null` records that a model has none, so it is only searched once. */
const rigs = new WeakMap<Object3D, Rig | null>();
/**
 * Where each bone started. It is kept per bone, not per rig: when the scene replaces a model with a
 * copy the rig is found again, and the bones must still remember the file's pose, not the current one.
 */
const restPoses = new WeakMap<Bone, ObjectTransform>();

/** A bone's current local transform, in the form commands and the panel use. */
export function poseOf(bone: Bone): ObjectTransform {
  return {
    position: bone.position.toArray(),
    rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z],
    scale: bone.scale.toArray(),
  };
}

/** The pose a bone is first seen in, which is the one the model file gave it. */
function restOf(bone: Bone): ObjectTransform {
  let rest = restPoses.get(bone);
  if (!rest) {
    rest = poseOf(bone);
    restPoses.set(bone, rest);
  }
  return rest;
}

function buildRig(root: Object3D): Rig | undefined {
  const bones: Bone[] = [];
  const skinned: SkinnedMesh[] = [];
  const indexOf = new Map<Object3D, number>();
  // Depth-first, children in file order. Pushing them in reverse makes the stack pop them in order.
  const pending: Object3D[] = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (isBone(node)) {
      indexOf.set(node, bones.length);
      bones.push(node);
    } else if (isSkinnedMesh(node)) {
      skinned.push(node);
    }
    for (let at = node.children.length - 1; at >= 0; at -= 1) {
      const child = node.children[at];
      if (child) pending.push(child);
    }
  }
  if (bones.length === 0) return undefined;

  const parents = new Int32Array(bones.length).fill(-1);
  const depths = new Uint16Array(bones.length);
  bones.forEach((bone, index) => {
    for (let above = bone.parent; above && above !== root.parent; above = above.parent) {
      const parent = indexOf.get(above);
      if (parent === undefined) continue;
      parents[index] = parent;
      depths[index] = (depths[parent] ?? 0) + 1;
      break;
    }
  });
  return { root, bones, parents, depths, rest: bones.map(restOf), skinned };
}

/** The rig of an imported model, or undefined when it has no bones. The answer is remembered. */
export function rigOf(root: Object3D): Rig | undefined {
  const known = rigs.get(root);
  if (known !== undefined) return known ?? undefined;
  const built = buildRig(root);
  rigs.set(root, built ?? null);
  return built;
}

/** The bone at `index`, or undefined when the rig has no such bone. */
export function boneAt(rig: Rig, index: number): Bone | undefined {
  return Number.isInteger(index) ? rig.bones[index] : undefined;
}

/** A bone's name as shown to the user: the file's own name, or its number when it has none. */
export function boneLabel(rig: Rig, index: number): string {
  return rig.bones[index]?.name || `Bone ${index + 1}`;
}
