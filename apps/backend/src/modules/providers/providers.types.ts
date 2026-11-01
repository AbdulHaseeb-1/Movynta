export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "anthropic-compatible",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export function isCompatibleProvider(id: ProviderId): boolean {
  return id === "openai-compatible" || id === "anthropic-compatible";
}
export interface ProviderView {
  id: ProviderId;
  model: string;
  configured: boolean;
  active: boolean;
  baseUrl: string;
}
export interface ProviderCredentials {
  id: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string | undefined;
}
