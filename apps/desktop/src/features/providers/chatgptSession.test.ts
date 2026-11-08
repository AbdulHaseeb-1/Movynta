import { describe, expect, it } from "vitest";
import {
  chatgptLoginStarted,
  chatgptSessionLoaded,
  chatgptSessionReducer,
  type ChatgptSession,
} from "./chatgptSession";

const session = (state: ChatgptSession["state"]): ChatgptSession => ({
  state,
  email: null,
  plan: null,
  connectedAt: null,
  expiresAt: null,
  error: null,
});
const start = () => chatgptSessionReducer(undefined, { type: "init" });

describe("the ChatGPT sign-in in the store", () => {
  it("keeps the sign-in page while the sign-in is pending, for a reopened Settings window", () => {
    let state = chatgptSessionReducer(start(), chatgptLoginStarted("https://auth.example/login"));
    state = chatgptSessionReducer(state, chatgptSessionLoaded(session("pending")));
    expect(state.authorizationUrl).toBe("https://auth.example/login");
  });

  it.each(["connected", "disconnected", "expired"] as const)("forgets the page once the sign-in is %s", (ended) => {
    let state = chatgptSessionReducer(start(), chatgptLoginStarted("https://auth.example/login"));
    state = chatgptSessionReducer(state, chatgptSessionLoaded(session(ended)));
    expect(state.authorizationUrl).toBeNull();
  });
});
