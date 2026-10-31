/** Injection tokens for the SDK runtime. Tests override `MODEL_PROVIDER` with a scripted model. */
export const MODEL_PROVIDER = Symbol("MODEL_PROVIDER");
export const AGENT_RUNNER = Symbol("AGENT_RUNNER");
export const AGENT_DEFINITIONS = Symbol("AGENT_DEFINITIONS");
