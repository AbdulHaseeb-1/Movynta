import { Injectable } from "@nestjs/common";
import { OpenAIProvider, type Model } from "@openai/agents";
import OpenAI from "openai";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ServiceUnavailableError } from "../../common/errors/app-error.js";
import type { ProviderCredentials } from "./providers.types.js";
import { providerEndpoint } from "./provider-endpoint.js";
import { noRedirectFetch } from "./no-redirect-fetch.js";
import { chatgptModel } from "./chatgpt/chatgpt-model.js";


@Injectable()
export class ProviderTransport {
  async model(credentials: ProviderCredentials): Promise<Model> {
    const { id, apiKey, model } = credentials;
    const baseUrl = providerEndpoint(id, credentials.baseUrl);
    switch (id) {
      case "openai":
        return new OpenAIProvider({ apiKey }).getModel(model);
      case "anthropic":
        return compatibleModel(aisdk(createAnthropic({ apiKey })(model)));
      case "openai-compatible":
        if (!baseUrl)
          throw new ServiceUnavailableError("A provider endpoint is required");
        return new OpenAIProvider({
          openAIClient: new OpenAI({
            apiKey,
            baseURL: baseUrl,
            fetch: noRedirectFetch,
          }),
          useResponses: false,
        }).getModel(model);
      case "anthropic-compatible":
        if (!baseUrl)
          throw new ServiceUnavailableError("A provider endpoint is required");
        return compatibleModel(
          aisdk(
            createAnthropic({
              apiKey,
              baseURL: baseUrl,
              fetch: noRedirectFetch,
            })(model),
          ),
        );
      case "google":
        return compatibleModel(
          aisdk(createGoogleGenerativeAI({ apiKey })(model)),
        );
      case "chatgpt":
        return chatgptModel(credentials);
    }
    throw new ServiceUnavailableError("Unknown model provider");
  }

  /** Compatible URLs are validated before use; redirects never forward credentials to another endpoint. */
  async models(credentials: ProviderCredentials): Promise<string[]> {
    const { id, apiKey } = credentials;
    if (id === "chatgpt")
      throw new ServiceUnavailableError("This provider has a fixed model list");
    const baseUrl = providerEndpoint(id, credentials.baseUrl);
    const url = baseUrl
      ? `${baseUrl}/models${id === "anthropic-compatible" ? "?limit=1000" : ""}`
      : id === "openai"
        ? "https://api.openai.com/v1/models"
        : id === "anthropic"
          ? "https://api.anthropic.com/v1/models?limit=1000"
          : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
    const headers: Record<string, string> =
      id === "openai" || id === "openai-compatible"
        ? { Authorization: `Bearer ${apiKey}` }
        : id === "anthropic" || id === "anthropic-compatible"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
          : { "x-goog-api-key": apiKey };
    try {
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("provider rejected request");
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null)
        throw new Error("invalid response");
      const rows =
        "data" in body ? body.data : "models" in body ? body.models : undefined;
      if (!Array.isArray(rows)) throw new Error("invalid model list");
      const models: string[] = [];
      for (const row of rows as unknown[]) {
        if (typeof row !== "object" || row === null) continue;
        if (
          id === "google" &&
          "supportedGenerationMethods" in row &&
          Array.isArray(row.supportedGenerationMethods) &&
          !row.supportedGenerationMethods.includes("generateContent")
        )
          continue;
        const name =
          "id" in row ? row.id : "name" in row ? row.name : undefined;
        if (typeof name === "string")
          models.push(name.replace(/^models\//, ""));
      }
      return [...new Set(models)].sort();
    } catch {
      throw new ServiceUnavailableError(
        "Could not load models. Check the provider key, network, and account access.",
      );
    }
  }
}

// Normalize the adapter's optional rawUsage for exactOptionalPropertyTypes without weakening SDK types.
function compatibleModel(adapter: ReturnType<typeof aisdk>): Model {
  return {
    async getResponse(request) {
      const { rawUsage, ...response } = await adapter.getResponse(request);
      return { ...response, ...(rawUsage === undefined ? {} : { rawUsage }) };
    },
    getStreamedResponse: (request) => adapter.getStreamedResponse(request),
    getRetryAdvice: (request) => adapter.getRetryAdvice(request),
  };
}
