import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * The active tool of the workspace. Select, Move, Rotate and Scale all let a drag orbit the view and a
 * click pick an object; the last three also show a handle on the selected object. Pan makes a drag move
 * the view instead.
 */
export type ViewportTool = "select" | "pan" | "move" | "rotate" | "scale";

const viewportSlice = createSlice({
  name: "viewport",
  initialState: { showGrid: true, tool: "select" as ViewportTool },
  reducers: {
    setShowGrid(state, action: PayloadAction<boolean>) {
      state.showGrid = action.payload;
    },
    setViewportTool(state, action: PayloadAction<ViewportTool>) {
      state.tool = action.payload;
    },
  },
});

export const { setShowGrid, setViewportTool } = viewportSlice.actions;
export const viewportReducer = viewportSlice.reducer;
