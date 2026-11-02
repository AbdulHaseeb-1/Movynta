import type { EditorScene, ObjectTransform } from "@/features/assistant";
import type { BoneSelection } from "./BoneSelection";
import { boneAt, boneLabel, poseOf, rigOf, type Rig } from "./rig";

/** One bone in the list the panel shows. */
export interface BoneItem {
  index: number;
  name: string;
  /** How far down the hierarchy the bone is, for indenting. */
  depth: number;
}

/** The selected model's rig, as the panel shows it. */
export interface RigInfo {
  objectId: string;
  modelName: string;
  bones: readonly BoneItem[];
}

/** The selected bone, with the transform the panel shows. */
export interface PosedBone {
  index: number;
  name: string;
  transform: ObjectTransform;
}

export interface RigView {
  rig: RigInfo | null;
  bone: PosedBone | null;
}

export const NO_RIG: RigView = { rig: null, bone: null };

/** The list is built once per rig: a rig does not change shape, only pose. */
const lists = new WeakMap<Rig, readonly BoneItem[]>();

function itemsOf(rig: Rig): readonly BoneItem[] {
  let items = lists.get(rig);
  if (!items) {
    items = rig.bones.map((_, index) => ({
      index,
      name: boneLabel(rig, index),
      depth: rig.depths[index] ?? 0,
    }));
    lists.set(rig, items);
  }
  return items;
}

/** The rigs of every model in the scene, by the id of the model. */
export function rigsIn(scene: EditorScene): Map<string, Rig> {
  const rigs = new Map<string, Rig>();
  for (const [id, object] of scene.entries()) {
    const rig = rigOf(object);
    if (rig) rigs.set(id, rig);
  }
  return rigs;
}

/** What the panel shows for the selected model and the selected bone. */
export function describeRig(scene: EditorScene, selection: BoneSelection): RigView {
  const objectId = scene.selection;
  const object = objectId ? scene.getObject(objectId) : undefined;
  const rig = object ? rigOf(object) : undefined;
  if (!objectId || !object || !rig) return NO_RIG;
  const picked = selection.selected;
  const bone = picked?.objectId === objectId ? boneAt(rig, picked.bone) : undefined;
  return {
    rig: { objectId, modelName: object.name || objectId, bones: itemsOf(rig) },
    bone: picked && bone ? { index: picked.bone, name: boneLabel(rig, picked.bone), transform: poseOf(bone) } : null,
  };
}
