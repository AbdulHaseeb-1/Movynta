import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { z } from "zod";
export const providerIdSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "anthropic-compatible",
  "chatgpt",
]);
export type ProviderId = z.infer<typeof providerIdSchema>;
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

export const providerIds: ProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "anthropic-compatible",
  "chatgpt",
];
/** The ChatGPT provider signs in with a subscription in the browser instead of taking an API key. */
export function isSubscriptionProvider(id: ProviderId) {
  return id === "chatgpt";
}
export function isCompatibleProvider(id: ProviderId) {
  return id === "openai-compatible" || id === "anthropic-compatible";
}
export const providerNames: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "openai-compatible": "OpenAI compatible",
  "anthropic-compatible": "Anthropic compatible",
  chatgpt: "ChatGPT",
};
