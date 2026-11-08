import { z } from "zod";

/** Providers that authenticate with an API key the user pastes in. */
export const API_KEY_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "anthropic-compatible",
] as const;

/** Every provider, including the one that signs in with a ChatGPT subscription instead of a key. */
export const PROVIDER_IDS = [...API_KEY_PROVIDER_IDS, "chatgpt"] as const;
/** The schema for a provider id. */
export const providerIdSchema = z.enum(PROVIDER_IDS);
/** The id of a model provider. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The ChatGPT provider signs in with a subscription in the browser instead of taking an API key. */
export function isSubscriptionProvider(id: ProviderId): boolean {
  return id === "chatgpt";
}

/** Compatible providers take an endpoint the user enters, such as a local or self-hosted gateway. */
export function isCompatibleProvider(id: ProviderId): boolean {
  return id === "openai-compatible" || id === "anthropic-compatible";
}
