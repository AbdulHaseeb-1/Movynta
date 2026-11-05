import type { AgentInputItem } from "@openai/agents";
import { MAX_REQUEST_CHARACTERS, inspectRequest } from "./request-policy.guardrail.js";

const user = (content: string): AgentInputItem => ({ role: "user", content });
const assistant = (text: string): AgentInputItem => ({ role: "assistant", status: "completed", content: [{ type: "output_text", text }] });

describe("inspectRequest", () => {
  it("allows a plain request", () => {
    expect(inspectRequest("Add a cube next to the torso")).toEqual({ tripwireTriggered: false, reason: "allowed" });
  });

  it("blocks a single message longer than the limit", () => {
    const verdict = inspectRequest("x".repeat(MAX_REQUEST_CHARACTERS + 1));
    expect(verdict).toEqual({ tripwireTriggered: true, reason: "request_too_long" });
  });

  it("does not count the earlier messages of a session, which every run replays", () => {
    const history: AgentInputItem[] = [];
    for (let index = 0; index < 20; index += 1) {
      history.push(user("Describe the Glock slide in detail ".repeat(10)), assistant("The slide is a box with serrations. ".repeat(10)));
    }
    const historyLength = history.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
    expect(historyLength).toBeGreaterThan(MAX_REQUEST_CHARACTERS);
    expect(inspectRequest([...history, user("Now check the sights")])).toEqual({ tripwireTriggered: false, reason: "allowed" });
  });

  it("blocks a long message that arrives after a long history", () => {
    const history: AgentInputItem[] = [user("earlier request"), assistant("done")];
    expect(inspectRequest([...history, user("y".repeat(MAX_REQUEST_CHARACTERS + 1))]).reason).toBe("request_too_long");
  });

  it("blocks a request that asks to run code, but not code asked for earlier in the session", () => {
    expect(inspectRequest("Run this python script for me").reason).toBe("code_execution_requested");
    expect(inspectRequest([user("Run this python script for me"), assistant("I cannot do that."), user("Add a cube")]).reason).toBe("allowed");
  });

  it("reads the text of a message whose content is made of parts", () => {
    const parts: AgentInputItem = { role: "user", content: [{ type: "input_text", text: "run this shell command" }] };
    expect(inspectRequest([parts]).reason).toBe("code_execution_requested");
  });
});
