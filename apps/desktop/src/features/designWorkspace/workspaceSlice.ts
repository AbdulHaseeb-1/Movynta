import { defaultKnifeSettings, type KnifeSettings } from "./knifeSettings";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ComponentSelectionOperation } from "./componentNeighbors";
import { loadPanelVisibility, type PanelId, type PanelVisibility } from "./panelStorage";

/** The two design modes: Object, and Edit. */
export type DesignMode = "object" | "edit";
/** The kind of component picked in Edit mode: a vertex, an edge or a face. */
export type ComponentKind = "vertex" | "edge" | "face";
interface WorkspaceState {
  mode: DesignMode;
  knifeActive: boolean;
  knifeSettings: KnifeSettings;
  componentKind: ComponentKind;
  componentSelection: {
    objectId: string;
    meshPath: number[];
    ids: string[];
  } | null;
  componentError: string;
  selectionRequest: { operation: ComponentSelectionOperation; sequence: number } | null;
  diagnosticSelection: {
    objectId: string;
    meshPath: number[];
    ids: string[];
    revision: number;
    sequence: number;
  } | null;
  panels: PanelVisibility;
}
const initialState: WorkspaceState = {
  mode: "object",
  knifeActive: false,
  knifeSettings: defaultKnifeSettings,
  componentKind: "face",
  componentSelection: null,
  componentError: "",
  selectionRequest: null,
  diagnosticSelection: null,
  panels: loadPanelVisibility(),
};

const workspaceSlice = createSlice({
  name: "designWorkspace",
  initialState,
  reducers: {
    setKnifeSettings(state, action: PayloadAction<Partial<KnifeSettings>>) {
      state.knifeSettings = { ...state.knifeSettings, ...action.payload };
    },
    setKnifeActive(state, action: PayloadAction<boolean>) {
      state.knifeActive = action.payload;
    },
    requestDiagnosticSelection(
      state,
      action: PayloadAction<{ objectId: string; meshPath: number[]; ids: string[]; revision: number }>,
    ) {
      state.diagnosticSelection = { ...action.payload, sequence: (state.diagnosticSelection?.sequence ?? 0) + 1 };
    },
    requestComponentSelection(state, action: PayloadAction<ComponentSelectionOperation>) {
      state.selectionRequest = { operation: action.payload, sequence: (state.selectionRequest?.sequence ?? 0) + 1 };
    },
    setDesignMode(state, action: PayloadAction<DesignMode>) {
      state.mode = action.payload;
      state.componentSelection = null;
      state.componentError = "";
    },
    setComponentKind(state, action: PayloadAction<ComponentKind>) {
      state.componentKind = action.payload;
      state.componentSelection = null;
      state.componentError = "";
    },
    setComponentSelection(state, action: PayloadAction<WorkspaceState["componentSelection"]>) {
      state.componentSelection = action.payload;
      // A message about the last attempt is out of date once something new is picked.
      if (action.payload) state.componentError = "";
    },
    setComponentError(state, action: PayloadAction<string>) {
      state.componentError = action.payload;
    },
    setPanelOpen(state, action: PayloadAction<{ id: PanelId; open: boolean }>) {
      state.panels[action.payload.id] = action.payload.open;
    },
  },
});

/** The actions that change the design mode, the picked components and the Edit-mode panels. */
export const {
  requestComponentSelection,
  requestDiagnosticSelection,
  setKnifeActive,
  setKnifeSettings,
  setDesignMode,
  setComponentKind,
  setComponentSelection,
  setComponentError,
  setPanelOpen,
} = workspaceSlice.actions;
/** The reducer for the design workspace state. */
export const designWorkspaceReducer = workspaceSlice.reducer;
