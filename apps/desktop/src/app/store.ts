import { configureStore } from "@reduxjs/toolkit";
import {
  chatgptSessionReducer,
  providersReducer,
} from "@/features/providers";
import { projectsReducer } from "@/features/projects";
import { viewportReducer } from "@/features/viewport3d/viewportSlice";
import { assistantSelectionReducer } from "@/features/assistant/selectionSlice";
import { saveSelection } from "@/features/assistant/selectionStorage";
import { designWorkspaceReducer } from "@/features/designWorkspace";
import { savePanelVisibility } from "@/features/designWorkspace/panelStorage";

export const store = configureStore({
  reducer: {
    providers: providersReducer,
    chatgptSession: chatgptSessionReducer,
    projects: projectsReducer,
    viewport: viewportReducer,
    assistantSelection: assistantSelectionReducer,
    designWorkspace: designWorkspaceReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Persist the chosen provider and model so they are restored on the next launch.
let savedSelection = store.getState().assistantSelection;
let savedPanels = store.getState().designWorkspace.panels;
store.subscribe(() => {
  const { assistantSelection, designWorkspace } = store.getState();
  if (assistantSelection !== savedSelection) { savedSelection = assistantSelection; saveSelection(assistantSelection); }
  if (designWorkspace.panels !== savedPanels) { savedPanels = designWorkspace.panels; savePanelVisibility(savedPanels); }
});
