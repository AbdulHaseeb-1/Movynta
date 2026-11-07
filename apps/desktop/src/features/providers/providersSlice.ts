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

export const providerSchema = z.object({
  id: providerIdSchema,
  model: z.string(),
  configured: z.boolean(),
  active: z.boolean(),
  baseUrl: z.string().default(""),
  /** False when a compatible endpoint's model cannot read pictures; the assistant then gets measurements only. */
  acceptsImages: z.boolean().default(true),
});
export const providersSchema = z.array(providerSchema);
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
export const { providersLoaded, backendDisconnected } = slice.actions;
export const providersReducer = slice.reducer;

export const providerIds = PROVIDER_IDS;
export const providerNames: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "openai-compatible": "OpenAI compatible",
  "anthropic-compatible": "Anthropic compatible",
  chatgpt: "ChatGPT",
};
