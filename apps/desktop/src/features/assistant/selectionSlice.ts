import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ProviderId } from "@/features/providers";
import { loadSelection, type AssistantSelection } from "./selectionStorage";
import type { ReasoningEffort } from "./reasoningEfforts";

const slice = createSlice({
  name: "assistantSelection",
  initialState: loadSelection() satisfies AssistantSelection,
  reducers: {
    selectAssistantProvider(state, action: PayloadAction<{ id: ProviderId; model: string }>) {
      state.providerId = action.payload.id;
      state.model = action.payload.model;
    },
    selectAssistantModel(state, action: PayloadAction<{ id: ProviderId; model: string }>) {
      state.providerId = action.payload.id;
      state.model = action.payload.model;
    },
    /** Replaces a missing or retired model with the first one the provider currently offers. */
    reconcileAssistantModel(state, action: PayloadAction<{ id: ProviderId; models: string[] }>) {
      const [first] = action.payload.models;
      if (state.providerId !== action.payload.id || first === undefined || action.payload.models.includes(state.model))
        return;
      state.model = first;
    },
    selectAssistantEffort(state, action: PayloadAction<{ key: string; effort: ReasoningEffort | null }>) {
      const { key, effort } = action.payload;
      if (effort === null) delete state.efforts[key];
      else state.efforts[key] = effort;
    },
  },
});
export const { selectAssistantProvider, selectAssistantModel, reconcileAssistantModel, selectAssistantEffort } =
  slice.actions;
export const assistantSelectionReducer = slice.reducer;
