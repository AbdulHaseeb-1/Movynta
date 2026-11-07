import { SkinnedMesh, type BufferGeometry, type Material, type Object3D } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { EditorCommand } from "@movynta/editor-protocol";
import { copyTopology } from "../meshGeometry/meshTopology";
import { commitStack, copyModifierStack, modifierStack } from "../meshGeometry/modifierStack";
import { isMesh } from "@/lib/three";

type CopySpec = Extract<EditorCommand, { type: "scene.duplicate_hierarchy" }>["copies"][number];
/** The memory a hierarchy's geometry is estimated to use, in bytes, at 8 bytes per value. */
export function hierarchyBytes(root: Object3D): number {
  let bytes = 0;
  root.traverse((node) => {
    if (!isMesh(node)) return;
    for (const attribute of Object.values(node.geometry.attributes)) bytes += attribute.count * attribute.itemSize * 8;
    for (const attribute of Object.values(node.geometry.morphAttributes).flatMap((targets) => targets ?? []))
      bytes += attribute.count * attribute.itemSize * 8;
    bytes += (node.geometry.index?.count ?? 0) * 4;
  });
  return bytes;
}

/** Own every geometry/material/base cage; share only immutable imported texture resources. */
export function duplicateHierarchy(
  source: Object3D,
  objects: ReadonlyMap<string, Object3D>,
  rootId: string,
  spec: CopySpec,
) {
  const sourceIds = new Map([...objects].map(([id, node]) => [node, id]));
  const originals: Object3D[] = [];
  source.traverse((node) => originals.push(node));
  const contained = new Set(originals);
  for (const node of originals)
    if (node instanceof SkinnedMesh && node.skeleton.bones.some((bone) => !contained.has(bone)))
      throw new Error("Copy a hierarchy that contains all skeleton bones");
  const descendants = originals.filter((node) => node !== source && sourceIds.has(node));
  const mapping = new Map(spec.descendants.map((entry) => [entry.sourceId, entry.objectId]));
  if (mapping.size !== descendants.length || descendants.some((node) => !mapping.has(sourceIds.get(node) ?? "")))
    throw new Error("Provide exactly one fresh ID mapping for every registered descendant");
  mapping.set(rootId, spec.objectId);
  const root = cloneSkeleton(source),
    clones: Object3D[] = [];
  root.traverse((node) => clones.push(node));
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>();
  const registered = new Map<string, Object3D>();
  try {
    originals.forEach((node, i) => {
      const copy = clones[i];
      if (!copy) throw new Error("Could not clone hierarchy");
      const id = sourceIds.get(node),
        next = id === undefined ? undefined : mapping.get(id);
      if (next) registered.set(next, copy);
      if (!isMesh(node) || !isMesh(copy)) return;
      copy.geometry = node.geometry.clone();
      geometries.add(copy.geometry);
      copyTopology(node.geometry, copy.geometry);
      const cloneMaterial = (material: Material) => {
        const result = material.clone();
        materials.add(result);
        return result;
      };
      copy.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
      copyModifierStack(node, copy);
      const stack = modifierStack(copy);
      if (stack) {
        geometries.add(stack.base);
        commitStack(copy, {
          ...stack,
          modifiers: stack.modifiers.map((modifier) =>
            modifier.kind === "boolean"
              ? { ...modifier, operandObjectId: mapping.get(modifier.operandObjectId) ?? modifier.operandObjectId }
              : modifier,
          ),
        });
      }
    });
    return { root, objects: registered };
  } catch (error) {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const node of clones) if (node instanceof SkinnedMesh) node.skeleton.dispose();
    throw error;
  }
}
