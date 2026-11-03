import { Matrix4, Vector3, type Object3D } from "three";
import { assignLocalMatrix } from "./shearFit";

const delta = new Matrix4();
const world = new Matrix4();
const start = new Matrix4();
const IDENTITY = new Matrix4();
const point = new Vector3();

/**
 * The objects of a selection that the handles must move. An object whose parent is also selected moves
 * with that parent, so moving it as well would move it twice.
 */
export function topLevel(objects: readonly Object3D[]): Object3D[] {
  const chosen = new Set(objects);
  return objects.filter((object) => {
    for (let above = object.parent; above; above = above.parent) if (chosen.has(above)) return false;
    return true;
  });
}

/** The average of the objects' world positions: the point the handles of a selection sit at. */
export function medianPosition(objects: readonly Object3D[], into: Vector3): Vector3 {
  into.set(0, 0, 0);
  if (objects.length === 0) return into;
  for (const object of objects) {
    object.updateWorldMatrix(true, false);
    into.add(object.getWorldPosition(point));
  }
  return into.divideScalar(objects.length);
}

/**
 * Moves, turns and scales several objects as one, by the same amount as a pivot that the handles
 * control: each object ends up where it would be if it were attached to the pivot when the drag began.
 * `begin` records where everything is; each `update` applies how far the pivot has since gone, so
 * the cost of a drag step follows the number of objects and nothing accumulates between steps.
 *
 * The starting matrices are kept in one array, and a parent's inverse is made once however many of its
 * children are dragged, so a step touches little memory even for a selection of thousands.
 */
export class GroupTransform {
  private objects: Object3D[] = [];
  /** The world matrix of each object when the drag began, sixteen numbers each. */
  private starts = new Float64Array(0);
  /** For each object, which of `inverses` undoes its parent's world matrix, or -1 for a parent that is the world. */
  private parentOf = new Int32Array(0);
  private inverses: Matrix4[] = [];
  private readonly pivotInverse = new Matrix4();

  begin(pivot: Object3D, objects: readonly Object3D[]): void {
    pivot.updateMatrixWorld(true);
    this.pivotInverse.copy(pivot.matrixWorld).invert();
    this.objects = [...objects];
    this.starts = new Float64Array(this.objects.length * 16);
    this.parentOf = new Int32Array(this.objects.length).fill(-1);
    this.inverses = [];
    const known = new Map<Object3D, number>();
    this.objects.forEach((object, index) => {
      object.updateWorldMatrix(true, false);
      object.matrixWorld.toArray(this.starts, index * 16);
      const parent = object.parent;
      if (!parent || parent.matrixWorld.equals(IDENTITY)) return;
      let at = known.get(parent);
      if (at === undefined) {
        at = this.inverses.push(parent.matrixWorld.clone().invert()) - 1;
        known.set(parent, at);
      }
      this.parentOf[index] = at;
    });
  }

  update(pivot: Object3D): void {
    pivot.updateMatrixWorld(true);
    delta.multiplyMatrices(pivot.matrixWorld, this.pivotInverse);
    this.objects.forEach((object, index) => {
      start.fromArray(this.starts, index * 16);
      world.multiplyMatrices(delta, start);
      const inverse = this.inverses[this.parentOf[index] ?? -1];
      if (inverse) world.premultiply(inverse);
      assignLocalMatrix(object, world, false);
    });
  }

  /** Folds a leftover shear into the meshes once, when the drag ends. */
  commit(): void {
    for (const object of this.objects) if (!object.matrixAutoUpdate) assignLocalMatrix(object, object.matrix, true);
  }

  end(): void {
    this.objects = [];
    this.starts = new Float64Array(0);
    this.parentOf = new Int32Array(0);
    this.inverses = [];
  }
}
