import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { NavigationTool } from "./viewport";

const viewportSlice = createSlice({
  name: "viewport",
  initialState: { showGrid: true, tool: "select" as NavigationTool },
  reducers: {
    setShowGrid(state, action: PayloadAction<boolean>) {
      state.showGrid = action.payload;
    },
    setNavigationTool(state, action: PayloadAction<NavigationTool>) {
      state.tool = action.payload;
    },
  },
});

export const { setShowGrid, setNavigationTool } = viewportSlice.actions;
export const viewportReducer = viewportSlice.reducer;
