import { configureStore } from "@reduxjs/toolkit";
import {
  chatgptSessionReducer,
  providersReducer,
} from "@/features/providers";
import { projectsReducer } from "@/features/projects";
import { viewportReducer } from "@/features/viewport3d/viewportSlice";
import { assistantSelectionReducer } from "@/features/assistant/selectionSlice";
import { saveSelection } from "@/features/assistant/selectionStorage";

export const store = configureStore({
  reducer: {
    providers: providersReducer,
    chatgptSession: chatgptSessionReducer,
    projects: projectsReducer,
    viewport: viewportReducer,
    assistantSelection: assistantSelectionReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Persist the chosen provider and model so they are restored on the next launch.
let savedSelection = store.getState().assistantSelection;
store.subscribe(() => {
  const { assistantSelection } = store.getState();
  if (assistantSelection === savedSelection) return;
  savedSelection = assistantSelection;
  saveSelection(assistantSelection);
});
