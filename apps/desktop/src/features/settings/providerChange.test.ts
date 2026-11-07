import { afterEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import {
  chatgptSessionLoaded,
  chatgptSessionReducer,
  providersLoaded,
  providersReducer,
  type ChatgptSession,
} from "@/features/providers";
import { setBackendToken } from "@/lib/backend";
import { changeProvider } from "./providerChange";

const connected: ChatgptSession = {
  state: "connected",
  email: "me@example.com",
  plan: "plus",
  connectedAt: "2026-11-01T00:00:00Z",
  expiresAt: "2026-12-01T00:00:00Z",
  error: null,
};
const signedOut: ChatgptSession = { state: "disconnected", email: null, plan: null, connectedAt: null, expiresAt: null, error: null };

function makeStore() {
  return configureStore({ reducer: { providers: providersReducer, chatgptSession: chatgptSessionReducer } });
}

function stubBackend(handle: (path: string, method: string) => unknown) {
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    const path = input.replace(/^.*\/api\/v1/, "");
    requests.push(`${method} ${path}`);
    return new Response(JSON.stringify(handle(path, method)), { status: 200 });
  });
  return requests;
}

describe("changing a provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the ChatGPT sign-in again after signing out, so the old account is not shown", async () => {
    setBackendToken("test");
    const store = makeStore();
    store.dispatch(chatgptSessionLoaded(connected));
    const requests = stubBackend((path) => (path.endsWith("/session") ? signedOut : []));
    await changeProvider(store.dispatch, "chatgpt", "DELETE");
    expect(requests).toEqual(["DELETE /providers/chatgpt", "GET /providers/chatgpt/session"]);
    expect(store.getState().chatgptSession.session?.state).toBe("disconnected");
  });

  it("leaves the ChatGPT sign-in alone when an API-key provider is removed", async () => {
    setBackendToken("test");
    const store = makeStore();
    store.dispatch(chatgptSessionLoaded(connected));
    store.dispatch(providersLoaded([]));
    const requests = stubBackend(() => []);
    await changeProvider(store.dispatch, "openai", "DELETE");
    expect(requests).toEqual(["DELETE /providers/openai"]);
    expect(store.getState().chatgptSession.session?.state).toBe("connected");
  });
});
