import {
  InputGuardrailTripwireTriggered,
  MaxTurnsExceededError,
} from "@openai/agents";
import type { RunStop } from "./run-clock.js";

export interface RunFailure {
  readonly code: string;
  /** Safe to show to the user. */
  readonly message: string;
}

const MAX_CHAIN_DEPTH = 5;
const MAX_DETAIL_LENGTH = 300;

/** Removes anything that looks like a credential before text is logged or shown. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-…")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza…")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 …")
    .replace(/(x-api-key|x-goog-api-key|api[_-]?key)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, "$1: …");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function chainOf(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;
  while (isRecord(current) && chain.length < MAX_CHAIN_DEPTH) {
    chain.push(current);
    current = current["cause"];
  }
  return chain;
}

function statusOf(link: Record<string, unknown>): number | undefined {
  const status = link["status"] ?? link["statusCode"];
  return typeof status === "number" ? status : undefined;
}

/** The provider's own explanation, which OpenAI and AI SDK errors keep in different places. */
function providerMessageOf(link: Record<string, unknown>): string | undefined {
  const body = link["error"];
  if (isRecord(body) && typeof body["message"] === "string") return body["message"];
  const raw = link["responseBody"];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        const inner = parsed["error"];
        if (isRecord(inner) && typeof inner["message"] === "string") return inner["message"];
        if (typeof parsed["message"] === "string") return parsed["message"];
      }
    } catch {
      return raw;
    }
  }
  return typeof link["message"] === "string" ? link["message"] : undefined;
}

function shorten(text: string): string {
  const clean = redactSecrets(text).replace(/\s+/g, " ").trim();
  return clean.length > MAX_DETAIL_LENGTH ? `${clean.slice(0, MAX_DETAIL_LENGTH)}…` : clean;
}

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

/**
 * Describes an error and its causes for the server log: names, HTTP status, provider codes and messages.
 * Secrets are removed, so the result is safe to log.
 */
export function describeError(error: unknown): string {
  const parts = chainOf(error).map((link) => {
    const name = typeof link["name"] === "string" ? link["name"] : "Error";
    const status = statusOf(link);
    const code = typeof link["code"] === "string" || typeof link["code"] === "number" ? ` code=${String(link["code"])}` : "";
    const type = typeof link["type"] === "string" ? ` type=${link["type"]}` : "";
    const message = providerMessageOf(link);
    return `${name}${status === undefined ? "" : ` status=${status}`}${code}${type}${message ? `: ${shorten(message)}` : ""}`;
  });
  return parts.length > 0 ? parts.join(" <- ") : shorten(String(error));
}

/** Maps failures to stable codes and messages that are safe to show to clients. */
export function classifyFailure(error: unknown, stop?: RunStop): RunFailure {
  if (stop === "timeout") return { code: "run_timeout", message: "The agent run exceeded its time limit" };
  if (stop === "stalled") return { code: "run_stalled", message: "The agent stopped making progress and was stopped" };
  if (error instanceof InputGuardrailTripwireTriggered)
    return { code: "guardrail_blocked", message: "This request cannot be processed" };
  if (error instanceof MaxTurnsExceededError)
    return { code: "max_turns_exceeded", message: "The agent reached its step limit" };

  const chain = chainOf(error);
  const link = chain.find((item) => statusOf(item) !== undefined);
  const status = link ? statusOf(link) : undefined;
  const detail = link ? providerMessageOf(link) : undefined;

  if (status === 401 || status === 403)
    return { code: "provider_auth", message: "The provider rejected the API key. Check it in provider settings." };
  if (status === 404)
    return { code: "provider_model_not_found", message: "The provider could not find the selected model for this account." };
  if (status === 429)
    return { code: "provider_rate_limited", message: "The provider is rate limiting requests or the account is out of quota. Try again shortly." };
  if (status === 400 || status === 422)
    return {
      code: "provider_bad_request",
      message: detail ? `The provider rejected the request: ${shorten(detail)}` : "The provider rejected the request.",
    };
  if (status !== undefined && status >= 500)
    return { code: "provider_unavailable", message: "The provider had an error. Try again shortly." };
  if (chain.some((item) => typeof item["message"] === "string" && item["message"].includes("finish_reason='length'") && item["message"].includes("produced no assistant text")))
    return {
      code: "model_output_truncated",
      message: "The model stopped before it could reply because the response hit its output limit. Try again.",
    };
  if (
    chain.some((item) => typeof item["code"] === "string" && NETWORK_CODES.has(item["code"])) ||
    chain.some((item) => typeof item["message"] === "string" && /fetch failed|network|socket/i.test(item["message"]))
  )
    return { code: "provider_unreachable", message: "Could not reach the provider. Check your network connection." };
  return { code: "run_failed", message: "The agent run failed. Check the backend log for details." };
}
