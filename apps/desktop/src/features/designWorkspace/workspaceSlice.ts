import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ComponentSelectionOperation } from "./componentNeighbors";
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
  selectionRequest: { operation: ComponentSelectionOperation; sequence: number } | null;
  panels: PanelVisibility;
}
const initialState: WorkspaceState = {
  mode: "object",
  componentKind: "face",
  componentSelection: null,
  componentError: "",
  selectionRequest: null,
  panels: loadPanelVisibility(),
};

const workspaceSlice = createSlice({
  name: "designWorkspace",
  initialState,
  reducers: {
    requestComponentSelection(state, action: PayloadAction<ComponentSelectionOperation>) {
      state.selectionRequest = { operation: action.payload, sequence: (state.selectionRequest?.sequence ?? 0) + 1 };
    },
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
  requestComponentSelection,
  setDesignMode,
  setComponentKind,
  setComponentSelection,
  setComponentError,
  setPanelOpen,
} = workspaceSlice.actions;
export const designWorkspaceReducer = workspaceSlice.reducer;
