import { Matrix3, Matrix4, Vector3 } from "three";
import type { BisectPlane } from "./meshBisect";

/** The two ways a command names a plane. */
export type PlaneSpec =
  | { readonly point: readonly number[]; readonly normal: readonly number[] }
  | { readonly axis: "x" | "y" | "z"; readonly offset: number };

/**
 * Turn a command's plane into a plane in mesh-local space, which is where the cage lives. A plane given in world
 * space moves with the object's transform: its point goes through the inverse matrix, and its normal through the
 * transpose of the matrix (a normal is not a direction along the surface, so it does not use the inverse).
 */
export function resolveBisectPlane(spec: PlaneSpec, space: "local" | "world", worldMatrix?: Matrix4): BisectPlane {
  let point: Vector3, normal: Vector3;
  if ("axis" in spec) {
    point = new Vector3();
    normal = new Vector3();
    const component = spec.axis === "x" ? "x" : spec.axis === "y" ? "y" : "z";
    point[component] = spec.offset;
    normal[component] = 1;
  } else {
    point = new Vector3().fromArray(spec.point);
    normal = new Vector3().fromArray(spec.normal);
  }
  if (space === "local") return { point, normal };
  if (!worldMatrix) throw new Error("A world-space plane needs the object's transform");
  const determinant = worldMatrix.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18)
    throw new Error(
      "The object's transform is singular, so a world-space plane cannot be mapped into it; use space local",
    );
  const local = point.applyMatrix4(new Matrix4().copy(worldMatrix).invert());
  const transposed = new Matrix3().setFromMatrix4(worldMatrix).transpose();
  return { point: local, normal: normal.applyMatrix3(transposed).normalize() };
}
