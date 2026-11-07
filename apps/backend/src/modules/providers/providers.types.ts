import type { ProviderId } from "@movynta/contracts";

// The provider list is shared with the desktop app; these re-exports keep this module's public names.
export {
  API_KEY_PROVIDER_IDS,
  PROVIDER_IDS,
  isCompatibleProvider,
  isSubscriptionProvider,
  type ProviderId,
} from "@movynta/contracts";

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
