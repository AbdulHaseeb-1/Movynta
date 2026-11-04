import type { BufferGeometry, Mesh } from "three";
import type { MeshModifierSpec } from "@movynta/editor-protocol";
import { copyTopology } from "./meshTopology";
import { modifyGeometry, type MeshModifier } from "./meshModifiers";

export interface ModifierStackState { base: BufferGeometry; modifiers: MeshModifierSpec[]; geometry: BufferGeometry }
const stacks = new WeakMap<Mesh, ModifierStackState>();
export function modifierStack(mesh: Mesh): ModifierStackState | undefined { return stacks.get(mesh); }
function cloneGeometry(source: BufferGeometry): BufferGeometry { const copy = source.clone(); copyTopology(source, copy); return copy; }

function operation(modifier: MeshModifierSpec): MeshModifier {
  return modifier.kind === "bevel"
    ? { type: "geometry.bevel", width: modifier.width, segments: modifier.segments, ...(modifier.profile === undefined ? {} : { profile: modifier.profile }), ...(modifier.angle === undefined ? {} : { angle: modifier.angle }) }
    : { type: "geometry.subdivide", levels: modifier.levels, ...(modifier.method === undefined ? {} : { method: modifier.method }) };
}

/** Evaluates `modifiers` from `base`. The base buffer itself stays intact. */
export function evaluateBase(base: BufferGeometry, modifiers: readonly MeshModifierSpec[]): BufferGeometry {
  let geometry = cloneGeometry(base);
  try {
    for (const modifier of modifiers) {
      if (!modifier.enabled) continue;
      const next = modifyGeometry(geometry, operation(modifier));
      geometry.dispose();
      geometry = next;
    }
    return geometry;
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

export function evaluateStack(mesh: Mesh, modifiers: MeshModifierSpec[], previous = stacks.get(mesh)): ModifierStackState {
  const base = previous?.base ?? cloneGeometry(mesh.geometry);
  try {
    return { base, modifiers, geometry: evaluateBase(base, modifiers) };
  } catch (error) {
    if (!previous) base.dispose();
    throw error;
  }
}
export function commitStack(mesh: Mesh, state: ModifierStackState): void { stacks.set(mesh, state); mesh.geometry = state.geometry; }
export function copyModifierStack(source: Mesh, target: Mesh): void {
  const state = stacks.get(source);
  if (state) stacks.set(target, { base: cloneGeometry(state.base), geometry: target.geometry, modifiers: state.modifiers.map((modifier) => ({ ...modifier })) });
}
export function disposeModifierStack(mesh: Mesh): void { const state = stacks.get(mesh); if (state) { state.base.dispose(); stacks.delete(mesh); } }
