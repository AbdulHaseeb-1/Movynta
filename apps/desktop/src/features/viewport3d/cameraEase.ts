import type { Vector3 } from "three";

/** Where a camera stands and what it looks at. */
export interface RestPose {
  position: Vector3;
  target: Vector3;
}

/** The camera's easing state: where it is and where it is heading. */
export interface CameraEase {
  /** Eases the camera to a new position and target, replacing any move still under way. */
  easeTo: (position: Vector3, target: Vector3) => void;
  /** Ends the move under way, leaving the camera where it is. */
  stop: () => void;
  /**
   * Where the camera will be once the move under way ends, or where it is now when nothing moves. A move
   * that is worked out relative to the view, such as a zoom step or restoring a shift, starts from here:
   * from the half-way point it would end up short of its mark, or off to one side.
   */
  restPose: () => RestPose;
}

/**
 * Moves a camera to a new pose over `seconds`, one frame at a time. `addFrameListener` adds the per-frame
 * callback and returns a function that removes it.
 */
export function createCameraEase(
  camera: { position: Vector3 },
  orbitTarget: Vector3,
  addFrameListener: (listener: (deltaSeconds: number) => void) => () => void,
  seconds: number,
): CameraEase {
  let end: RestPose | undefined;
  let removeListener: (() => void) | undefined;
  const stop = () => {
    removeListener?.();
    removeListener = undefined;
    end = undefined;
  };
  const easeTo = (position: Vector3, target: Vector3) => {
    stop();
    const fromPosition = camera.position.clone();
    const fromTarget = orbitTarget.clone();
    const goal = { position: position.clone(), target: target.clone() };
    end = goal;
    let elapsed = 0;
    removeListener = addFrameListener((delta) => {
      elapsed += delta;
      const progress = Math.min(elapsed / seconds, 1);
      const eased = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(fromPosition, goal.position, eased);
      orbitTarget.lerpVectors(fromTarget, goal.target, eased);
      if (progress >= 1) stop();
    });
  };
  const restPose = (): RestPose => {
    const pose = end ?? { position: camera.position, target: orbitTarget };
    return { position: pose.position.clone(), target: pose.target.clone() };
  };
  return { easeTo, stop, restPose };
}
