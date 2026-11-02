import { describe, expect, it } from "vitest";
import { savedExchangesToMessages } from "./conversationMessages";

const base = { runId: "run_1", prompt: "Make a crate", createdAt: "2026-11-02T09:00:00.000Z" };

describe("savedExchangesToMessages", () => {
  it("rebuilds a request and its reply, oldest first", () => {
    const messages = savedExchangesToMessages([
      { ...base, status: "completed", reply: "  Done. " },
      { ...base, runId: "run_2", prompt: "Add a lid", status: "completed", reply: "Added." },
    ]);
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Make a crate"],
      ["assistant", "Done."],
      ["user", "Add a lid"],
      ["assistant", "Added."],
    ]);
    expect(messages[1]).toMatchObject({ id: "run_1", state: "done", activity: [] });
    expect(new Set(messages.map((message) => message.id)).size).toBe(4);
  });

  it("keeps the failure reason and marks cut-short runs as cancelled", () => {
    const [, failed, , cut] = savedExchangesToMessages([
      { ...base, status: "failed", error: "Provider rejected the model" },
      { ...base, runId: "run_2", status: "running" },
    ]);
    expect(failed).toMatchObject({ state: "error", error: "Provider rejected the model" });
    expect(cut).toMatchObject({ state: "cancelled", content: "" });
  });

  it("gives a failed run without a reason a readable one", () => {
    const [, failed] = savedExchangesToMessages([{ ...base, status: "failed" }]);
    expect(failed?.error).toBe("The request failed.");
  });

  it("returns nothing for an empty project", () => {
    expect(savedExchangesToMessages([])).toEqual([]);
  });
});
