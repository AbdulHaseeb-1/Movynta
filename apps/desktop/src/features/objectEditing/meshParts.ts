import type { Mesh, Object3D } from "three";
import { meshPathSchema, resolveMeshPath, stableSteps, type MeshStep } from "@movynta/editor-protocol";
import { isEditableTarget } from "@/features/meshGeometry/meshInspection";

/** One mesh of an object, with the path that names it. */
export interface MeshPart {
  mesh: Mesh;
  /** By part name where a part has one, so it keeps meaning the same part when others are added or reordered. */
  path: MeshStep[];
}

/** An object whose meshes can be chosen as another mesh's boolean operand. */
export interface OperandChoice {
  objectId: string;
  name: string;
  parts: MeshPart[];
  /** The object, which a stored path is followed in. Missing for an operand that is no longer in the scene. */
  root?: Object3D;
}

/** Every mesh in an object, with its path by part name. */
export function partsOf(root: Object3D | undefined): MeshPart[] {
  const parts: MeshPart[] = [];
  const visit = (node: Object3D, path: MeshStep[]) => {
    if (isEditableTarget(node)) parts.push({ mesh: node, path });
    const steps = stableSteps(node);
    node.children.forEach((child, index) => visit(child, [...path, steps[index] ?? index]));
  };
  if (root) visit(root, []);
  return parts;
}

/** The path of the part a stored path leads to, in the form the list uses, so a path stored as indexes still shows as chosen. */
export function listedPath(operand: OperandChoice | undefined, path: readonly MeshStep[]): readonly MeshStep[] {
  const target = operand?.root ? resolveMeshPath(operand.root, path) : undefined;
  return operand?.parts.find((candidate) => candidate.mesh === target)?.path ?? path;
}

/** A path as the text of a choice in a list: JSON, since a part's name can hold any character. */
export function pathValue(path: readonly MeshStep[]): string {
  return path.length === 0 ? "root" : JSON.stringify(path);
}

/** The path a choice in a list stands for. Text that is not a path is the empty path. */
export function pathFrom(value: string): MeshStep[] {
  if (value === "root") return [];
  try {
    const parsed = meshPathSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
