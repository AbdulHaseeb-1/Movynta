import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ShadingMode } from "./shading";
import { loadViewportDisplay, type ViewportDisplay } from "./viewportStorage";

/**
 * The active tool of the workspace. Select, Move, Rotate and Scale all let a drag orbit the view and a
 * click pick an object; the last three also show a handle on the selected object. Pan makes a drag move
 * the view instead.
 */
export type ViewportTool = "select" | "pan" | "move" | "rotate" | "scale";

export interface ViewportState {
  tool: ViewportTool;
  display: ViewportDisplay;
}

/** Whether surfaces are see-through now: X-ray is on and the shading supports it. */
export function xrayActive(display: Pick<ViewportDisplay, "shadingMode" | "xray">): boolean {
  return display.xray && display.shadingMode !== "default";
}

function applyShadingMode(display: ViewportDisplay, mode: ShadingMode) {
  display.shadingMode = mode;
  if (mode !== "wireframe") display.lastShadedMode = mode;
}

const initialState: ViewportState = { tool: "select", display: loadViewportDisplay() };

const viewportSlice = createSlice({
  name: "viewport",
  initialState,
  reducers: {
    setShadingMode(state, action: PayloadAction<ShadingMode>) {
      applyShadingMode(state.display, action.payload);
    },
    /** Shift+Z: into Wireframe, or back to the shading used before it. */
    toggleWireframe(state) {
      applyShadingMode(
        state.display,
        state.display.shadingMode === "wireframe" ? state.display.lastShadedMode : "wireframe",
      );
    },
    setXray(state, action: PayloadAction<boolean>) {
      state.display.xray = action.payload;
    },
    /** Alt+Z. Material shading has no X-ray, so turning it on there switches to Solid, as Blender does. */
    toggleXray(state) {
      if (xrayActive(state.display)) {
        state.display.xray = false;
        return;
      }
      state.display.xray = true;
      if (state.display.shadingMode === "default") applyShadingMode(state.display, "solid");
    },
    setShowGrid(state, action: PayloadAction<boolean>) {
      state.display.showGrid = action.payload;
    },
    setViewportTool(state, action: PayloadAction<ViewportTool>) {
      state.tool = action.payload;
    },
  },
});

export const { setShowGrid, setViewportTool, setShadingMode, setXray, toggleWireframe, toggleXray } =
  viewportSlice.actions;
export const viewportReducer = viewportSlice.reducer;
