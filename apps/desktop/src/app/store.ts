import { configureStore } from "@reduxjs/toolkit";
import { chatgptSessionReducer, providersReducer } from "@/features/providers";
import { projectsReducer } from "@/features/projects";
import { viewportReducer } from "@/features/viewport3d/viewportSlice";
import { saveViewportDisplay } from "@/features/viewport3d/viewportStorage";
import { assistantSelectionReducer } from "@/features/assistant/selectionSlice";
import { saveSelection } from "@/features/assistant/selectionStorage";
import { designWorkspaceReducer } from "@/features/designWorkspace";
import { savePanelVisibility } from "@/features/designWorkspace/panelStorage";
import { helpReducer } from "@/features/documentation/shortcuts/helpSlice";

export const store = configureStore({
  reducer: {
    providers: providersReducer,
    chatgptSession: chatgptSessionReducer,
    projects: projectsReducer,
    viewport: viewportReducer,
    assistantSelection: assistantSelectionReducer,
    designWorkspace: designWorkspaceReducer,
    help: helpReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Persist the chosen provider and model, the open panels and the view's shading, so they are restored on the next launch.
let savedSelection = store.getState().assistantSelection;
let savedPanels = store.getState().designWorkspace.panels;
let savedDisplay = store.getState().viewport.display;
store.subscribe(() => {
  const { assistantSelection, designWorkspace, viewport } = store.getState();
  if (viewport.display !== savedDisplay) {
    savedDisplay = viewport.display;
    saveViewportDisplay(savedDisplay);
  }
  if (assistantSelection !== savedSelection) {
    savedSelection = assistantSelection;
    saveSelection(assistantSelection);
  }
  if (designWorkspace.panels !== savedPanels) {
    savedPanels = designWorkspace.panels;
    savePanelVisibility(savedPanels);
  }
});
