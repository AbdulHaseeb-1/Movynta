import { Box3, MathUtils, Vector3, type Object3D } from "three";

/** Empty space left around the framed objects, as a factor of their size. */
const MARGIN = 1.2;
/** Used for a single point or an empty object, which has no size to fit. */
const MIN_RADIUS = 0.5;
const DEFAULT_DIRECTION = new Vector3(5, 4, 7).normalize();

export interface CameraPose {
  position: Vector3;
  target: Vector3;
}

export interface FrameLimits {
  minDistance: number;
  maxDistance: number;
}

/**
 * The camera that shows `box` whole, looking at its center from the direction the camera looks from now.
 * The distance fits the box's bounding sphere in both the vertical and the horizontal field of view.
 */
export function framePose(
  box: Box3,
  from: CameraPose,
  fovDegrees: number,
  aspect: number,
  limits: FrameLimits,
): CameraPose {
  const center = box.getCenter(new Vector3());
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, MIN_RADIUS);
  const vertical = MathUtils.degToRad(fovDegrees) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = MathUtils.clamp((radius * MARGIN) / Math.sin(Math.min(vertical, horizontal)), limits.minDistance, limits.maxDistance);
  const direction = from.position.clone().sub(from.target);
  if (direction.lengthSq() < 1e-12) direction.copy(DEFAULT_DIRECTION);
  direction.normalize();
  return { position: center.clone().addScaledVector(direction, distance), target: center };
}

/** The part of an editor scene that framing reads. */
export interface FrameSource {
  readonly selectedIds: readonly string[];
  getObject(id: string): Object3D | undefined;
  pickables(): Object3D[];
}

/**
 * The box to frame: the selected objects, or every object when nothing is selected or `scope` is "all".
 * Hidden objects are left out, since there is nothing to see there. Null when there is nothing to frame.
 */
export function boxToFrame(source: FrameSource, scope: "selection" | "all" = "selection"): Box3 | null {
  const chosen = scope === "selection" ? source.selectedIds.flatMap((id) => source.getObject(id) ?? []) : [];
  const objects = chosen.length > 0 ? chosen : source.pickables();
  const box = new Box3();
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    let visible = true;
    for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) visible = false;
    if (!visible) continue;
    const part = new Box3().setFromObject(object);
    if (part.isEmpty()) part.setFromCenterAndSize(object.getWorldPosition(new Vector3()), new Vector3());
    box.union(part);
  }
  return box.isEmpty() ? null : box;
}
