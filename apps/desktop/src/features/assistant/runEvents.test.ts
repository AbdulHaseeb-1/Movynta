import { describe, expect, it } from "vitest";
import { applyRunEvent, settleActivity, toolLabel } from "./runEvents";
import type { ChatMessage } from "./types";

const empty: ChatMessage = {
  id: "m",
  role: "assistant",
  content: "",
  state: "streaming",
  activity: [],
  startedAt: 1000,
};

describe("applyRunEvent", () => {
  it("appends streamed text", () => {
    const next = [
      { type: "agent.message.delta", payload: { delta: "Hel" } },
      { type: "agent.message.delta", payload: { delta: "lo" } },
    ].reduce(applyRunEvent, empty);
    expect(next.content).toBe("Hello");
  });

  it("tracks a tool from start to completion", () => {
    const started = applyRunEvent(empty, {
      type: "tool.started",
      payload: { toolName: "editor.get_context", permission: "read" },
    });
    expect(started.activity[0]).toMatchObject({
      label: "Reading the scene",
      status: "running",
    });
    const done = applyRunEvent(started, {
      type: "tool.completed",
      payload: { toolName: "editor.get_context", durationMs: 40 },
    });
    expect(done.activity[0]).toMatchObject({ status: "done", durationMs: 40 });
  });

  it("keeps activity at its position between streamed messages", () => {
    const result = [
      { type: "agent.message.delta", payload: { delta: "Before" } },
      { type: "tool.started", payload: { toolName: "editor.get_context" } },
      { type: "agent.message.delta", payload: { delta: "After" } },
    ].reduce(applyRunEvent, empty);
    expect(result.activity[0]?.contentOffset).toBe(6);
    expect(result.content).toBe("BeforeAfter");
  });

  it("marks failed tools and settles leftovers", () => {
    const failed = applyRunEvent(
      applyRunEvent(empty, {
        type: "tool.started",
        payload: { toolName: "x.y", permission: "read" },
      }),
      { type: "tool.failed", payload: { toolName: "x.y", message: "boom" } },
    );
    expect(failed.activity[0]).toMatchObject({
      status: "failed",
      detail: "boom",
    });
    const pending = applyRunEvent(empty, {
      type: "approval.required",
      payload: { summary: "s" },
    });
    expect(settleActivity(pending).activity[0]?.status).toBe("done");
  });

  it("records how long the agent thought before its first output", () => {
    const first = applyRunEvent(
      empty,
      { type: "agent.message.delta", payload: { delta: "Hi" } },
      4500,
    );
    expect(first.thinkingMs).toBe(3500);
    const later = applyRunEvent(
      first,
      { type: "agent.message.delta", payload: { delta: "!" } },
      9000,
    );
    expect(later.thinkingMs).toBe(3500);
  });

  it("humanizes unknown tool names", () => {
    expect(toolLabel("custom.make_thing")).toBe("Custom make thing");
  });
});
