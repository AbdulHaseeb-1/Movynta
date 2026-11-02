import { MathUtils } from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import { ROTATION_SNAP_DEGREES, SCALE_SNAP, TRANSLATION_SNAP } from "./transformMath";

/**
 * Makes holding Shift snap the handles of `controls` to whole steps, the same for every set of handles
 * in the workspace. Returns a function that removes the key listeners.
 */
export function bindShiftSnap(controls: TransformControls): () => void {
  const snap = (on: boolean) => {
    controls.setTranslationSnap(on ? TRANSLATION_SNAP : null);
    controls.setRotationSnap(on ? MathUtils.degToRad(ROTATION_SNAP_DEGREES) : null);
    controls.setScaleSnap(on ? SCALE_SNAP : null);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Shift") snap(event.type === "keydown");
  };
  const onBlur = () => snap(false);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    window.removeEventListener("blur", onBlur);
  };
}
