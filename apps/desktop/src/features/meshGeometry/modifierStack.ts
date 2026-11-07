import { Matrix4, SkinnedMesh, Vector3, type BufferGeometry, type Mesh } from "three";
import type { MeshModifierSpec } from "@movynta/editor-protocol";
import { cageKey, copyTopology, readTopology } from "./meshTopology";
import { modifyGeometry, type MeshModifier } from "./meshModifiers";
import { extrudeAlongRegionNormal, extrudeRegion, writeExtrudedGeometry } from "./meshExtrude";
import { applyBoolean } from "./meshBoolean";
import { repeatGeometry } from "./repetitionModifiers";

/** The operand solid, already in its own local space, plus the matrix that places it in the world. */
export interface BooleanOperandView {
  geometry: BufferGeometry;
  matrixWorld: Matrix4;
}

/** Lets a boolean modifier read another mesh. Absent for stacks that do not boolean. */
export interface ModifierEvalContext {
  matrixWorld: Matrix4;
  materialSlots: number;
  operand(objectId: string, meshPath: readonly (number | string)[]): BooleanOperandView;
}

export interface ModifierStackState {
  base: BufferGeometry;
  modifiers: MeshModifierSpec[];
  geometry: BufferGeometry;
}
const stacks = new WeakMap<Mesh, ModifierStackState>();
/** The modifier stack stored for a mesh, or undefined when it has none. */
export function modifierStack(mesh: Mesh): ModifierStackState | undefined {
  return stacks.get(mesh);
}
function cloneGeometry(source: BufferGeometry): BufferGeometry {
  const copy = source.clone();
  copyTopology(source, copy);
  return copy;
}

function operation(
  modifier: Exclude<MeshModifierSpec, { kind: "extrusion" | "boolean" | "array" | "mirror" }>,
): MeshModifier {
  return modifier.kind === "bevel"
    ? {
        type: "geometry.bevel",
        width: modifier.width,
        segments: modifier.segments,
        ...(modifier.profile === undefined ? {} : { profile: modifier.profile }),
        ...(modifier.angle === undefined ? {} : { angle: modifier.angle }),
      }
    : {
        type: "geometry.subdivide",
        levels: modifier.levels,
        ...(modifier.method === undefined ? {} : { method: modifier.method }),
      };
}

/** Evaluates `modifiers` from `base`. The base buffer itself stays intact. */
export function evaluateBase(
  base: BufferGeometry,
  modifiers: readonly MeshModifierSpec[],
  context?: ModifierEvalContext,
): BufferGeometry {
  let geometry = cloneGeometry(base);
  let startsAtBase = true;
  try {
    for (const modifier of modifiers) {
      if (!modifier.enabled) continue;
      let next: BufferGeometry;
      if (modifier.kind === "extrusion") {
        const cage = readTopology(geometry);
        if (cageKey(cage) !== modifier.baseKey) {
          throw new Error("The live extrusion's base cage changed. Inspect the base and choose its faces again.");
        }
        const result =
          modifier.normalDistance !== undefined
            ? extrudeAlongRegionNormal(cage, modifier.ids, modifier.normalDistance, modifier)
            : extrudeRegion(
                cage,
                modifier.componentKind ?? "face",
                modifier.ids,
                new Vector3().fromArray(modifier.offset ?? []),
                modifier,
              );
        // Caps and retained faces occupy their original face slots. Walls and back caps are generated.
        result.mesh.faceSources = result.mesh.faces.map((_, index) =>
          index >= cage.faces.length ? -1 : startsAtBase ? index : (cage.faceSources?.[index] ?? -1),
        );
        next = writeExtrudedGeometry(geometry, result);
      } else if (modifier.kind === "boolean") {
        if (!context) throw new Error("Boolean modifier needs its operand in the scene");
        const source = context.operand(modifier.operandObjectId, modifier.operandMeshPath);
        if (Math.abs(context.matrixWorld.determinant()) < 1e-12) throw new Error("Target transform cannot be inverted");
        const relative = new Matrix4().copy(context.matrixWorld).invert().multiply(source.matrixWorld);
        if (modifier.cutMaterialIndex !== undefined && modifier.cutMaterialIndex >= context.materialSlots) {
          throw new Error("Boolean cut material is outside the target's material slots");
        }
        next = applyBoolean(
          geometry,
          source.geometry,
          modifier.operation,
          relative,
          modifier.cutMaterialIndex,
          context.materialSlots,
        );
      } else if (modifier.kind === "array" || modifier.kind === "mirror") {
        next = repeatGeometry(geometry, modifier, startsAtBase);
      } else {
        next = modifyGeometry(geometry, operation(modifier), startsAtBase);
      }
      startsAtBase = false;
      geometry.dispose();
      geometry = next;
    }
    return geometry;
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

/** Evaluates a modifier list on the mesh's base geometry. Throws if the base cage changed under a live extrusion, or a boolean has no operand in the scene. */
export function evaluateStack(
  mesh: Mesh,
  modifiers: MeshModifierSpec[],
  previous = stacks.get(mesh),
  context?: ModifierEvalContext,
): ModifierStackState {
  const blocked = modifiers.find(
    (modifier) =>
      modifier.enabled &&
      (modifier.kind === "extrusion" ||
        modifier.kind === "boolean" ||
        modifier.kind === "array" ||
        modifier.kind === "mirror"),
  );
  if (mesh instanceof SkinnedMesh && blocked) {
    if (blocked.kind === "array" || blocked.kind === "mirror")
      throw new Error("Array/mirror modifiers on skinned meshes are not supported; duplicate the hierarchy instead");
    throw new Error(
      blocked.kind === "boolean"
        ? "Boolean modifiers on skinned meshes are not supported"
        : "Live extrusion on skinned meshes is not supported",
    );
  }
  const base = previous?.base ?? cloneGeometry(mesh.geometry);
  try {
    return { base, modifiers, geometry: evaluateBase(base, modifiers, context) };
  } catch (error) {
    if (!previous) base.dispose();
    throw error;
  }
}
/** Makes a stack state the mesh's current stack, and shows its geometry. */
export function commitStack(mesh: Mesh, state: ModifierStackState): void {
  stacks.set(mesh, state);
  mesh.geometry = state.geometry;
}
/** Copies the stack of one mesh to another, with its own copy of the base geometry. */
export function copyModifierStack(source: Mesh, target: Mesh): void {
  const state = stacks.get(source);
  if (state)
    stacks.set(target, {
      base: cloneGeometry(state.base),
      geometry: target.geometry,
      modifiers: state.modifiers.map((modifier) => ({ ...modifier })),
    });
}
/** Frees the geometry a mesh's stack holds, when the mesh is removed. */
export function disposeModifierStack(mesh: Mesh): void {
  const state = stacks.get(mesh);
  if (state) {
    state.base.dispose();
    stacks.delete(mesh);
  }
}
