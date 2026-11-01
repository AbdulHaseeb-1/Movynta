import { OpenAIProvider, Runner, type Model, type ModelProvider } from "@openai/agents";
import { ServiceUnavailableError } from "../../common/errors/app-error.js";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import { AGENT_RUNNER, MODEL_PROVIDER } from "./agent.tokens.js";

const disabledProvider: ModelProvider = {
  getModel(): Model {
    throw new ServiceUnavailableError("AI agents are disabled on this server");
  },
};

/**
 * Creates one `Runner` for the whole process. Requests reuse it instead of
 * constructing a new runner per HTTP call.
 */
export const agentRuntimeProviders = [
  {
    provide: MODEL_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): ModelProvider => {
      if (!config.agents.enabled || !config.agents.apiKey) return disabledProvider;
      return new OpenAIProvider({ apiKey: config.agents.apiKey });
    },
  },
  {
    provide: AGENT_RUNNER,
    inject: [MODEL_PROVIDER, APP_CONFIG],
    useFactory: (modelProvider: ModelProvider, config: AppConfig): Runner =>
      new Runner({
        modelProvider,
        tracingDisabled: config.agents.tracingDisabled,
        traceIncludeSensitiveData: false,
      }),
  },
];
