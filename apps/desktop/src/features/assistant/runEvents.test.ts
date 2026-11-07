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

  it("shows the independent review as one step that ends with its verdict", () => {
    const started = applyRunEvent(empty, { type: "review.started", payload: { attempt: 1 } });
    expect(started.activity[0]).toMatchObject({ kind: "review", label: "Independent review of the result", status: "running" });
    const failed = applyRunEvent(started, { type: "review.completed", payload: { attempt: 1, outcome: "needs_refinement", summary: "The backrest floats.", findingCount: 2 } });
    expect(failed.activity[0]).toMatchObject({ label: "Review found 2 problems to fix", status: "failed", detail: "The backrest floats." });
    const again = applyRunEvent(failed, { type: "review.started", payload: { attempt: 2 } });
    expect(again.activity[1]).toMatchObject({ label: "Reviewing the fixes", status: "running" });
    const passed = applyRunEvent(again, { type: "review.completed", payload: { attempt: 2, outcome: "ready", summary: "Matches the request.", findingCount: 2 } });
    expect(passed.activity[1]).toMatchObject({ label: "Review passed", status: "done" });
    const blocked = applyRunEvent(applyRunEvent(empty, { type: "review.started", payload: { attempt: 1 } }), { type: "review.completed", payload: { attempt: 1, outcome: "blocked", summary: "", findingCount: 0 } });
    expect(blocked.activity[0]).toMatchObject({ label: "Review could not judge the result", status: "failed" });
    expect(blocked.activity[0]?.detail).toBeUndefined();
  });

  it("attaches the pictures the assistant looked at to the step that took them", () => {
    const started = applyRunEvent(empty, {
      type: "tool.started",
      payload: { toolName: "viewport.capture", permission: "read" },
    });
    expect(started.activity[0]).toMatchObject({ label: "Looking at the scene", status: "running" });
    const captured = applyRunEvent(started, {
      type: "viewport.captured",
      payload: { captureId: "cap_1", views: [{ label: "front", width: 768, height: 576 }], imagesSent: true },
    });
    expect(captured.activity).toHaveLength(1);
    expect(captured.activity[0]).toMatchObject({ captureId: "cap_1", status: "running" });
    expect(captured.activity[0]?.detail).toBeUndefined();
    const done = applyRunEvent(captured, {
      type: "tool.completed",
      payload: { toolName: "viewport.capture", durationMs: 120 },
    });
    expect(done.activity[0]).toMatchObject({ captureId: "cap_1", status: "done", durationMs: 120 });
  });

  it("explains a look that drew nothing, and ignores one that names no pictures", () => {
    const started = applyRunEvent(empty, {
      type: "tool.started",
      payload: { toolName: "viewport.capture", permission: "read" },
    });
    const measured = applyRunEvent(started, {
      type: "viewport.captured",
      payload: { captureId: "cap_2", views: [], imagesSent: false },
    });
    expect(measured.activity[0]?.detail).toMatch(/Pictures are turned off for this model/);
    expect(applyRunEvent(started, { type: "viewport.captured", payload: { imagesSent: true } })).toBe(started);
    // Without the tool step running there is nothing to attach them to.
    expect(applyRunEvent(empty, { type: "viewport.captured", payload: { captureId: "cap_3", imagesSent: true } })).toBe(empty);
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
