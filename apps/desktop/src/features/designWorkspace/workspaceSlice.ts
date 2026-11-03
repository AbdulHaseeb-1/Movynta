import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { loadPanelVisibility, type PanelId, type PanelVisibility } from "./panelStorage";

export type DesignMode = "object" | "edit";
export type ComponentKind = "vertex" | "edge" | "face";
interface WorkspaceState {
  mode: DesignMode;
  componentKind: ComponentKind;
  componentSelection: {
    objectId: string;
    meshPath: number[];
    ids: string[];
  } | null;
  componentError: string;
  panels: PanelVisibility;
}
const initialState: WorkspaceState = {
  mode: "object",
  componentKind: "face",
  componentSelection: null,
  componentError: "",
  panels: loadPanelVisibility(),
};

const workspaceSlice = createSlice({
  name: "designWorkspace",
  initialState,
  reducers: {
    setDesignMode(state, action: PayloadAction<DesignMode>) {
      state.mode = action.payload;
      state.componentSelection = null;
    },
    setComponentKind(state, action: PayloadAction<ComponentKind>) {
      state.componentKind = action.payload;
      state.componentSelection = null;
    },
    setComponentSelection(
      state,
      action: PayloadAction<WorkspaceState["componentSelection"]>,
    ) {
      state.componentSelection = action.payload;
    },
    setComponentError(state, action: PayloadAction<string>) {
      state.componentError = action.payload;
    },
    setPanelOpen(state, action: PayloadAction<{ id: PanelId; open: boolean }>) { state.panels[action.payload.id] = action.payload.open; },
  },
});

export const {
  setDesignMode,
  setComponentKind,
  setComponentSelection,
  setComponentError,
  setPanelOpen,
} = workspaceSlice.actions;
export const designWorkspaceReducer = workspaceSlice.reducer;
