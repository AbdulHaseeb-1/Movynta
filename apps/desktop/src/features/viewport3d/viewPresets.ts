import { MathUtils, Vector3 } from "three";

/** The id of a view preset: front, back, right, left, top or bottom. */
export type ViewPresetId = "front" | "back" | "right" | "left" | "top" | "bottom" | "isometric";

/** A preset view of the scene, with its key. */
export interface ViewPreset {
  id: ViewPresetId;
  label: string;
  /** Unit direction from the target to the camera. Y is up and a front view stands on +Z, as in the assistant's captures. */
  direction: readonly [number, number, number];
  /** The numpad key that picks it, as `KeyboardEvent.code`. Back, left and bottom need Ctrl as well. */
  code?: string;
  withCtrl?: boolean;
}

const ISOMETRIC_ELEVATION = MathUtils.degToRad(35.264);
const isometric = [
  Math.sin(Math.PI / 4) * Math.cos(ISOMETRIC_ELEVATION),
  Math.sin(ISOMETRIC_ELEVATION),
  Math.cos(Math.PI / 4) * Math.cos(ISOMETRIC_ELEVATION),
] as const;

/** The preset views of the scene. */
export const VIEW_PRESETS: readonly ViewPreset[] = [
  { id: "front", label: "Front", direction: [0, 0, 1], code: "Numpad1" },
  { id: "back", label: "Back", direction: [0, 0, -1], code: "Numpad1", withCtrl: true },
  { id: "right", label: "Right", direction: [1, 0, 0], code: "Numpad3" },
  { id: "left", label: "Left", direction: [-1, 0, 0], code: "Numpad3", withCtrl: true },
  { id: "top", label: "Top", direction: [0, 1, 0], code: "Numpad7" },
  { id: "bottom", label: "Bottom", direction: [0, -1, 0], code: "Numpad7", withCtrl: true },
  { id: "isometric", label: "Isometric", direction: isometric },
];

/** The preset a numpad key picks, with or without Ctrl, or undefined for any other key. */
export function presetForKey(code: string, ctrl: boolean): ViewPreset | undefined {
  return VIEW_PRESETS.find((preset) => preset.code === code && (preset.withCtrl ?? false) === ctrl);
}

/** A view straight along the vertical has no defined "up" on screen, so it is tilted by a hair to keep the orbit stable. */
const POLE_NUDGE = 1e-4;

/** The position of a camera at `distance` from `target` looking from `direction`. */
export function viewPosition(target: Vector3, direction: readonly [number, number, number], distance: number): Vector3 {
  const unit = new Vector3(...direction);
  if (Math.abs(unit.y) > 1 - 1e-9) unit.z += POLE_NUDGE * Math.sign(unit.y);
  return target.clone().addScaledVector(unit.normalize(), distance);
}
