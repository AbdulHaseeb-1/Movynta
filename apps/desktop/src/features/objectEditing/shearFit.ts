import {
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type Object3D,
} from "three";
import { modifierStack } from "../meshGeometry/modifierStack";

const SHEAR_LIMIT = 1e-5;
type Attribute = BufferAttribute | InterleavedBufferAttribute;

function isMesh(object: Object3D): object is Mesh {
  return object instanceof Mesh;
}

/** World position of one vertex, after any shear baked into the geometry. */
export function meshVertexWorld(object: Object3D, index: number): Vector3 {
  if (!isMesh(object)) throw new Error("Expected a mesh");
  const position = object.geometry.getAttribute("position");
  if (!position) throw new Error("Expected positions");
  object.updateWorldMatrix(true, false);
  return new Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
}

function nearlyIdentity(matrix: Matrix4): boolean {
  const identity = new Matrix4().elements;
  const elements = matrix.elements;
  for (let i = 0; i < 16; i += 1) if (Math.abs((elements[i] ?? 0) - (identity[i] ?? 0)) > SHEAR_LIMIT) return false;
  return true;
}

function transformPositions(attribute: Attribute, matrix: Matrix4): void {
  const vector = new Vector3();
  for (let index = 0; index < attribute.count; index += 1) {
    vector.fromBufferAttribute(attribute, index).applyMatrix4(matrix);
    attribute.setXYZ(index, vector.x, vector.y, vector.z);
  }
  attribute.needsUpdate = true;
}

function transformDirections(attribute: Attribute, normalMatrix: Matrix3): void {
  const vector = new Vector3();
  for (let index = 0; index < attribute.count; index += 1) {
    vector.fromBufferAttribute(attribute, index).applyNormalMatrix(normalMatrix);
    if (vector.lengthSq() > 0) vector.normalize();
    if (attribute.itemSize >= 4) attribute.setXYZW(index, vector.x, vector.y, vector.z, attribute.getW(index));
    else attribute.setXYZ(index, vector.x, vector.y, vector.z);
  }
  attribute.needsUpdate = true;
}

/** Moves positions by the part of `residual` that decompose() cannot store. */
function transformGeometry(geometry: BufferGeometry, residual: Matrix4): void {
  const position = geometry.getAttribute("position");
  if (position) transformPositions(position, residual);
  const linear = residual.clone();
  linear.elements[12] = 0;
  linear.elements[13] = 0;
  linear.elements[14] = 0;
  const morphMatrix = geometry.morphTargetsRelative ? linear : residual;
  for (const target of geometry.morphAttributes.position ?? []) transformPositions(target, morphMatrix);
  const normalMatrix = new Matrix3().getNormalMatrix(residual);
  const normal = geometry.getAttribute("normal");
  if (normal) transformDirections(normal, normalMatrix);
  for (const target of geometry.morphAttributes.normal ?? []) transformDirections(target, normalMatrix);
  const tangent = geometry.getAttribute("tangent");
  // A tangent lies along the surface, so it follows the matrix itself; only normals use the inverse transpose.
  // The residual never mirrors (a mirror stays in the object's scale), so the handedness in w is unchanged.
  if (tangent) transformDirections(tangent, new Matrix3().setFromMatrix4(linear));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function bakeMesh(mesh: Mesh, residual: Matrix4): void {
  const stack = modifierStack(mesh);
  if (stack) {
    const base = stack.base.clone();
    transformGeometry(base, residual);
    stack.base.dispose();
    stack.base = base;
    const displayed = stack.geometry.clone();
    transformGeometry(displayed, residual);
    stack.geometry = displayed;
    mesh.geometry = displayed;
    return;
  }
  const geometry = mesh.geometry.clone();
  transformGeometry(geometry, residual);
  mesh.geometry = geometry;
}

function childMatrix(child: Object3D, into: Matrix4): Matrix4 {
  if (!child.matrixAutoUpdate) return into.copy(child.matrix);
  child.updateMatrix();
  return into.copy(child.matrix);
}

/**
 * Writes `local` onto `object`. A pure position, rotation and scale is stored as usual. When those three
 * cannot hold the matrix, `bake` folds the leftover into the mesh and its children; otherwise the exact
 * matrix is kept until a later bake.
 */
export function assignLocalMatrix(object: Object3D, local: Matrix4, bake: boolean): void {
  const exact = local.clone();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  exact.decompose(position, quaternion, scale);
  // From a matrix whose axes are not perpendicular, three.js gives a quaternion that is not of unit length. Stored
  // as it is, the object would stay slightly sheared after the bake and be baked again by its next move.
  quaternion.normalize();
  object.position.copy(position);
  object.quaternion.copy(quaternion);
  object.scale.copy(scale);
  const rebuilt = new Matrix4().compose(position, quaternion, scale);
  const residual = new Matrix4().copy(rebuilt).invert().multiply(exact);
  const shear = Math.abs(rebuilt.determinant()) > 1e-12 && !nearlyIdentity(residual);
  if (shear && bake) {
    if (isMesh(object)) bakeMesh(object, residual);
    const carried = new Matrix4();
    for (const child of object.children) assignLocalMatrix(child, residual.clone().multiply(childMatrix(child, carried)), true);
    object.matrixAutoUpdate = true;
    object.updateMatrix();
    return;
  }
  if (shear) {
    object.matrix.copy(exact);
    object.matrixAutoUpdate = false;
    object.matrixWorldNeedsUpdate = true;
    return;
  }
  object.matrixAutoUpdate = true;
  object.updateMatrix();
}

/**
 * Bakes objects whose matrix is still an exact shear left by a reparent or a group drag. A child whose
 * parent is in the same set is baked by that parent, so the leftover is applied once.
 */
export function settleShear(objects: Iterable<Object3D>): void {
  const pending = [...objects];
  const chosen = new Set(pending);
  for (const object of pending) {
    if (object.matrixAutoUpdate) continue;
    let covered = false;
    for (let above = object.parent; above; above = above.parent) {
      if (chosen.has(above) && !above.matrixAutoUpdate) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    assignLocalMatrix(object, object.matrix.clone(), true);
    object.updateMatrixWorld(true);
  }
}

/** True when the parent's world scale is different on two axes, which is what drops a world rotation. */
export function hasNonUniformWorldScale(object: Object3D): boolean {
  const parent = object.parent;
  if (!parent) return false;
  parent.updateWorldMatrix(true, false);
  const scale = new Vector3();
  parent.matrixWorld.decompose(new Vector3(), new Quaternion(), scale);
  const limit = 1e-4 * Math.max(1, Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  return Math.abs(Math.abs(scale.x) - Math.abs(scale.y)) > limit || Math.abs(Math.abs(scale.y) - Math.abs(scale.z)) > limit;
}

/**
 * The local matrix of a world-axis rotation about the object's origin, including a non-uniform parent.
 * `axisInParentSpace` is the axis after the parent's rotation has been removed, which is how the
 * handles report it.
 */
export function correctWorldRotation(object: Object3D, startWorld: Matrix4, axisInParentSpace: Vector3, angle: number): void {
  const axis = axisInParentSpace.clone();
  const parent = object.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    const quaternion = new Quaternion();
    parent.matrixWorld.decompose(new Vector3(), quaternion, new Vector3());
    axis.applyQuaternion(quaternion);
  }
  if (axis.lengthSq() < 1e-12) return;
  axis.normalize();
  const origin = new Vector3().setFromMatrixPosition(startWorld);
  const desired = new Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(new Matrix4().makeRotationAxis(axis, angle))
    .multiply(new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z))
    .multiply(startWorld);
  const local = parent ? new Matrix4().copy(parent.matrixWorld).invert().multiply(desired) : desired.clone();
  assignLocalMatrix(object, local, false);
}
