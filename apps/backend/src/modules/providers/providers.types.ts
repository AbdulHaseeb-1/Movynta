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
export type ProviderId = (typeof PROVIDER_IDS)[number];
export function isSubscriptionProvider(id: ProviderId): boolean {
  return id === "chatgpt";
}
export function isCompatibleProvider(id: ProviderId): boolean {
  return id === "openai-compatible" || id === "anthropic-compatible";
}
export interface ProviderView {
  id: ProviderId;
  model: string;
  configured: boolean;
  active: boolean;
  baseUrl: string;
  /** False when the endpoint's model cannot read pictures, so tools return measurements only. */
  acceptsImages: boolean;
}
export interface ProviderCredentials {
  id: ProviderId;
  model: string;
  /** The API key, or the subscription access token for a subscription provider. */
  apiKey: string;
  baseUrl?: string | undefined;
  /** Set for subscription providers, which route requests by account. */
  accountId?: string | undefined;
}
