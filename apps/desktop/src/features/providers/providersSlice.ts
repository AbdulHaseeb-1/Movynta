import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { z } from "zod";
import {
  isCompatibleProvider,
  isSubscriptionProvider,
  PROVIDER_IDS,
  providerIdSchema,
  type ProviderId,
} from "@movynta/contracts";

export { isCompatibleProvider, isSubscriptionProvider, providerIdSchema, type ProviderId };

/** The schema for one model provider as the backend returns it. */
export const providerSchema = z.object({
  id: providerIdSchema,
  model: z.string(),
  configured: z.boolean(),
  active: z.boolean(),
  baseUrl: z.string().default(""),
  /** False when a compatible endpoint's model cannot read pictures; the assistant then gets measurements only. */
  acceptsImages: z.boolean().default(true),
});
/** The schema for the list of providers. */
export const providersSchema = z.array(providerSchema);
/** A model provider as the app knows it. */
export type Provider = z.infer<typeof providerSchema>;
interface ProvidersState {
  items: Provider[];
  connected: boolean;
}
const initialState: ProvidersState = { items: [], connected: false };
const slice = createSlice({
  name: "providers",
  initialState,
  reducers: {
    providersLoaded(state, action: PayloadAction<Provider[]>) {
      state.items = action.payload;
      state.connected = true;
    },
    backendDisconnected() {
      return initialState;
    },
  },
});
/** The actions that record the loaded providers, and that the backend has disconnected. */
export const { providersLoaded, backendDisconnected } = slice.actions;
/** The reducer for the model providers. */
export const providersReducer = slice.reducer;

/** The ids of all model providers, in order. */
export const providerIds = PROVIDER_IDS;
/** The display name of each model provider. */
export const providerNames: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "openai-compatible": "OpenAI compatible",
  "anthropic-compatible": "Anthropic compatible",
  chatgpt: "ChatGPT",
};
