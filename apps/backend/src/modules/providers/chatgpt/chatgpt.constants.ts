import type { ModelSettings } from "@openai/agents";

/**
 * Endpoints and limits for signing in with a ChatGPT subscription. The flow is the OAuth 2.0
 * authorization-code flow with PKCE that OpenAI's own Codex client uses. It is meant for local,
 * personal use of the user's own subscription.
 */
export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_AUTHORIZE_URL = `${CHATGPT_ISSUER}/oauth/authorize`;
export const CHATGPT_TOKEN_URL = `${CHATGPT_ISSUER}/oauth/token`;
export const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_SCOPES = "openid profile email offline_access";
/** The client registration only allows this loopback redirect, so the callback port is fixed. */
export const CHATGPT_CALLBACK_PORT = 1455;
export const CHATGPT_CALLBACK_PATH = "/auth/callback";
export const CHATGPT_REDIRECT_URI = `http://localhost:${CHATGPT_CALLBACK_PORT}${CHATGPT_CALLBACK_PATH}`;

/** Inference endpoint for subscription accounts (Responses API). */
export const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CHATGPT_ORIGINATOR = "codex_cli_rs";
/**
 * The model list is filtered by the client version the caller reports: an old version only sees old
 * (or no) models. This is a high version so the account's current models are returned.
 */
export const CHATGPT_CLIENT_VERSION = "1.0.0";
export const CHATGPT_CATALOG_TTL_MS = 10 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
/** A sign-in is valid for 30 days from the moment it is made, however often the tokens refresh. */
export const CHATGPT_LOGIN_TTL_MS = 30 * 24 * HOUR_MS;
/** How long the browser has to finish a sign-in. */
export const CHATGPT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
/** Access tokens closer than this to expiry are refreshed before use. */
export const CHATGPT_REFRESH_MARGIN_MS = 10 * 60 * 1000;
export const CHATGPT_REQUEST_TIMEOUT_MS = 15000;

/** Stored in `model_providers.encrypted_key`, which holds no secret for a subscription provider. */
export const CHATGPT_KEY_PLACEHOLDER = "subscription:chatgpt";

/**
 * Settings the subscription backend requires. It rejects stored responses, so conversation state
 * stays on this server and reasoning is returned encrypted to be replayed on the next turn.
 */
export const CHATGPT_MODEL_SETTINGS: ModelSettings = {
  store: false,
  providerData: { include: ["reasoning.encrypted_content"] },
};
