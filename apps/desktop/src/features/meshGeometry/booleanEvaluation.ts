import { type Mesh, SkinnedMesh, type BufferGeometry, type Object3D } from "three";
import { resolveMeshPath, type MeshModifierSpec, type MeshPath } from "@movynta/editor-protocol";
import { evaluateBase, modifierStack, type ModifierEvalContext, type ModifierStackState } from "./modifierStack";
import { isMesh } from "@/lib/three";

/** A mesh of the scene, as a boolean operation sees it. */
export interface SceneMesh {
  objectId: string;
  /** The scene object this mesh is part of, which a path to one of its meshes is taken from. */
  root: Object3D;
  /** Where the mesh is in that object, as child indices. */
  meshPath: number[];
  mesh: Mesh;
}

/** A change to a mesh that a boolean operation produces. */
export interface MeshChange {
  base?: BufferGeometry;
  modifiers?: MeshModifierSpec[];
}

type BooleanModifier = Extract<MeshModifierSpec, { kind: "boolean" }>;

/**
 * The mesh a boolean modifier names: the one `path` leads to inside the object `objectId`, whether the path is
 * written with names or with child indices. The path is followed in the object, not compared with other paths, so a
 * name and an index that lead to the same mesh find the same mesh.
 */
function operandSlot(slots: readonly SceneMesh[], objectId: string, path: MeshPath): SceneMesh | undefined {
  const root = slots.find((entry) => entry.objectId === objectId)?.root;
  const target = root ? resolveMeshPath(root, path) : undefined;
  return target === undefined ? undefined : slots.find((entry) => entry.objectId === objectId && entry.mesh === target);
}

/** Every mesh in the scene, including child parts, in child-index order. */
export function sceneMeshes(objects: ReadonlyMap<string, Object3D>): SceneMesh[] {
  const found: SceneMesh[] = [];
  for (const [objectId, root] of objects) {
    const visit = (node: Object3D, path: number[]) => {
      if (isMesh(node)) found.push({ objectId, root, meshPath: path, mesh: node });
      node.children.forEach((child, index) => visit(child, [...path, index]));
    };
    visit(root, []);
  }
  return found;
}

function modifiersOf(mesh: Mesh, changes: ReadonlyMap<Mesh, MeshChange>): readonly MeshModifierSpec[] {
  return changes.get(mesh)?.modifiers ?? modifierStack(mesh)?.modifiers ?? [];
}

function enabledBooleans(modifiers: readonly MeshModifierSpec[]): BooleanModifier[] {
  return modifiers.filter((modifier): modifier is BooleanModifier => modifier.enabled && modifier.kind === "boolean");
}

/**
 * True when this batch enables a boolean or changes a mesh that an existing boolean uses.
 * Other stacks keep the single-mesh evaluator.
 */
export function needsBooleanEvaluation(
  slots: readonly SceneMesh[],
  planned: ReadonlyMap<Mesh, readonly MeshModifierSpec[]>,
): boolean {
  for (const modifiers of planned.values()) if (enabledBooleans(modifiers).length > 0) return true;
  const changed = new Set(planned.keys());
  for (const slot of slots) {
    for (const modifier of enabledBooleans(modifierStack(slot.mesh)?.modifiers ?? [])) {
      const operand = operandSlot(slots, modifier.operandObjectId, modifier.operandMeshPath);
      if (operand && changed.has(operand.mesh)) return true;
    }
  }
  return false;
}

function findOperand(slots: readonly SceneMesh[], modifier: BooleanModifier, target: Mesh): SceneMesh {
  const slot = operandSlot(slots, modifier.operandObjectId, modifier.operandMeshPath);
  if (!slot) throw new Error(`Boolean operand "${modifier.operandObjectId}" does not exist`);
  if (slot.mesh === target) throw new Error("A boolean modifier cannot use its own mesh");
  return slot;
}

function skinnedBoolean(mesh: Mesh, modifiers: readonly MeshModifierSpec[]): void {
  if (!(mesh instanceof SkinnedMesh)) return;
  const blocked = modifiers.find(
    (modifier) =>
      modifier.enabled &&
      (modifier.kind === "extrusion" ||
        modifier.kind === "boolean" ||
        modifier.kind === "array" ||
        modifier.kind === "mirror"),
  );
  if (!blocked) return;
  if (blocked.kind === "array" || blocked.kind === "mirror")
    throw new Error("Array/mirror modifiers on skinned meshes are not supported; duplicate the hierarchy instead");
  throw new Error(
    blocked.kind === "boolean"
      ? "Boolean modifiers on skinned meshes are not supported"
      : "Live extrusion on skinned meshes is not supported",
  );
}

/**
 * Evaluates changed meshes, and boolean targets whose operand changed, in dependency order.
 * `transforms` recomputes every enabled boolean from the current world matrices.
 * Throws without committing. Partial results are disposed; caller-owned bases are kept.
 */
export function evaluateAffected(
  slots: readonly SceneMesh[],
  changes: ReadonlyMap<Mesh, MeshChange>,
  mode: "dependencies" | "transforms",
  transformed?: ReadonlySet<Mesh>,
): Map<Mesh, ModifierStackState> {
  const modifiersFor = (mesh: Mesh) => modifiersOf(mesh, changes);
  const baseFor = (mesh: Mesh): BufferGeometry => changes.get(mesh)?.base ?? modifierStack(mesh)?.base ?? mesh.geometry;
  const must = new Set<Mesh>();
  if (mode === "transforms") {
    if (!transformed) {
      for (const slot of slots) if (enabledBooleans(modifiersFor(slot.mesh)).length > 0) must.add(slot.mesh);
    } else {
      const changed = new Set(transformed);
      let grew = true;
      while (grew) {
        grew = false;
        for (const slot of slots) {
          if (must.has(slot.mesh)) continue;
          const booleans = enabledBooleans(modifiersFor(slot.mesh));
          if (!booleans.length) continue;
          const affected =
            changed.has(slot.mesh) ||
            booleans.some((modifier) => {
              const operand = operandSlot(slots, modifier.operandObjectId, modifier.operandMeshPath);
              return operand !== undefined && changed.has(operand.mesh);
            });
          if (affected) {
            must.add(slot.mesh);
            changed.add(slot.mesh);
            grew = true;
          }
        }
      }
    }
  } else {
    for (const mesh of changes.keys()) must.add(mesh);
    let grew = true;
    while (grew) {
      grew = false;
      for (const slot of slots) {
        if (must.has(slot.mesh)) continue;
        for (const modifier of enabledBooleans(modifiersFor(slot.mesh))) {
          const operand = operandSlot(slots, modifier.operandObjectId, modifier.operandMeshPath);
          if (operand && must.has(operand.mesh)) {
            must.add(slot.mesh);
            grew = true;
          }
        }
      }
    }
  }

  const incoming = new Map<Mesh, number>();
  const dependents = new Map<Mesh, Mesh[]>();
  for (const mesh of must) {
    incoming.set(mesh, 0);
    dependents.set(mesh, []);
  }
  for (const mesh of must) {
    const seen = new Set<Mesh>();
    for (const modifier of enabledBooleans(modifiersFor(mesh))) {
      const operand = findOperand(slots, modifier, mesh);
      if (!must.has(operand.mesh) || seen.has(operand.mesh)) continue;
      seen.add(operand.mesh);
      dependents.get(operand.mesh)?.push(mesh);
      incoming.set(mesh, (incoming.get(mesh) ?? 0) + 1);
    }
  }
  const queue = [...must].filter((mesh) => (incoming.get(mesh) ?? 0) === 0);
  const order: Mesh[] = [];
  while (queue.length > 0) {
    const mesh = queue.shift();
    if (!mesh) break;
    order.push(mesh);
    for (const dependent of dependents.get(mesh) ?? []) {
      const count = (incoming.get(dependent) ?? 1) - 1;
      incoming.set(dependent, count);
      if (count === 0) queue.push(dependent);
    }
  }
  if (order.length !== must.size) throw new Error("Boolean modifiers form a cycle");

  const results = new Map<Mesh, ModifierStackState>();
  try {
    for (const mesh of order) {
      const slot = slots.find((entry) => entry.mesh === mesh);
      if (!slot) throw new Error("Boolean target is missing from the scene");
      const modifiers = modifiersFor(mesh);
      skinnedBoolean(mesh, modifiers);
      mesh.updateWorldMatrix(true, false);
      const context: ModifierEvalContext = {
        matrixWorld: mesh.matrixWorld,
        materialSlots: Array.isArray(mesh.material) ? mesh.material.length : 1,
        operand(objectId, meshPath) {
          const operand = operandSlot(slots, objectId, meshPath);
          if (!operand) throw new Error(`Boolean operand "${objectId}" does not exist`);
          if (operand.mesh === mesh) throw new Error("A boolean modifier cannot use its own mesh");
          operand.mesh.updateWorldMatrix(true, false);
          const evaluated = results.get(operand.mesh);
          return { geometry: evaluated?.geometry ?? operand.mesh.geometry, matrixWorld: operand.mesh.matrixWorld };
        },
      };
      const base = baseFor(mesh);
      const geometry = modifiers.some((modifier) => modifier.enabled) ? evaluateBase(base, modifiers, context) : base;
      results.set(mesh, { base, modifiers: [...modifiers], geometry });
    }
    return results;
  } catch (error) {
    for (const [mesh, state] of results) {
      const live = modifierStack(mesh);
      if (state.geometry !== mesh.geometry && state.geometry !== live?.geometry && state.geometry !== state.base)
        state.geometry.dispose();
    }
    throw error;
  }
}
