import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ProviderId } from "@/features/providers";
import { loadSelection, type AssistantSelection } from "./selectionStorage";
import type { ReasoningEffort } from "./reasoningEfforts";

const slice = createSlice({
  name: "assistantSelection",
  initialState: loadSelection() satisfies AssistantSelection,
  reducers: {
    selectAssistantProvider(
      state,
      action: PayloadAction<{ id: ProviderId; model: string }>,
    ) {
      state.providerId = action.payload.id;
      state.model = action.payload.model;
    },
    selectAssistantModel(
      state,
      action: PayloadAction<{ id: ProviderId; model: string }>,
    ) {
      state.providerId = action.payload.id;
      state.model = action.payload.model;
    },
    selectAssistantEffort(
      state,
      action: PayloadAction<{ key: string; effort: ReasoningEffort | null }>,
    ) {
      const { key, effort } = action.payload;
      if (effort === null) delete state.efforts[key];
      else state.efforts[key] = effort;
    },
  },
});
export const {
  selectAssistantProvider,
  selectAssistantModel,
  selectAssistantEffort,
} = slice.actions;
export const assistantSelectionReducer = slice.reducer;
