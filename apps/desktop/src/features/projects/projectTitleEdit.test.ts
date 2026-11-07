import { describe, expect, it, vi } from "vitest";
import { saveTitleEdit } from "./projectTitleEdit";

describe("saving an edited project name", () => {
  it("sends the trimmed name", async () => {
    const onRename = vi.fn(() => Promise.resolve());
    expect(await saveTitleEdit("  Robot  ", "Old", onRename)).toEqual({ kind: "saved" });
    expect(onRename).toHaveBeenCalledWith("Robot");
  });

  it("sends nothing when the name did not change", async () => {
    const onRename = vi.fn(() => Promise.resolve());
    expect(await saveTitleEdit("Robot ", "Robot", onRename)).toEqual({ kind: "unchanged" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("allows an empty name, which makes the project untitled", async () => {
    const onRename = vi.fn(() => Promise.resolve());
    expect(await saveTitleEdit("  ", "Robot", onRename)).toEqual({ kind: "saved" });
    expect(onRename).toHaveBeenCalledWith("");
  });

  it("reports a failure instead of dropping it, so the title keeps the typed name", async () => {
    const outcome = await saveTitleEdit("Robot", "Old", () => Promise.reject(new Error("The backend request failed.")));
    expect(outcome).toEqual({ kind: "failed", message: "The backend request failed." });
  });
});
