import { OpenAIProvider, type Model } from "@openai/agents";
import OpenAI from "openai";
import { ServiceUnavailableError } from "../../../common/errors/app-error.js";
import { noRedirectFetch } from "../no-redirect-fetch.js";
import type { ProviderCredentials } from "../providers.types.js";
import { CHATGPT_BASE_URL, CHATGPT_ORIGINATOR } from "./chatgpt.constants.js";

/** A Responses API model served from the ChatGPT subscription backend. */
export function chatgptModel(credentials: ProviderCredentials): Promise<Model> {
  const { apiKey, accountId, model } = credentials;
  if (!accountId) throw new ServiceUnavailableError("The ChatGPT account is missing. Sign in again in Settings.");
  const client = new OpenAI({
    apiKey,
    baseURL: CHATGPT_BASE_URL,
    defaultHeaders: {
      "chatgpt-account-id": accountId,
      "OpenAI-Beta": "responses=experimental",
      originator: CHATGPT_ORIGINATOR,
    },
    fetch: noRedirectFetch,
  });
  return new OpenAIProvider({ openAIClient: client, useResponses: true }).getModel(model);
}
