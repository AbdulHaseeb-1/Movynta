import { Color } from "three";

/** How a rig is drawn. The selected bone uses the same orange as the selected object's outline. */
export const BONE_COLOR = new Color("#5fa8ff");
export const SELECTED_BONE_COLOR = new Color("#ff9b21");
export const JOINT_COLOR = new Color("#f2f4f8");
export const JOINT_SIZE_PX = 6;
/** Drawn above the model, so the skeleton can be seen and grabbed through the surface. */
export const OVERLAY_RENDER_ORDER = 998;
