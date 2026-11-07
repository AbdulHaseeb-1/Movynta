import { describe, expect, it } from "vitest";
import { OncePerKey, RunSlot } from "./runSlot";

describe("RunSlot", () => {
  it("lets one request hold the conversation at a time", () => {
    const slot = new RunSlot();
    const first = slot.acquire();
    expect(first).toBeDefined();
    expect(slot.acquire()).toBeUndefined();
    if (first) slot.release(first);
    expect(slot.acquire()).toBeDefined();
  });

  it("hands the conversation to the next message while a stopped request is still winding down", () => {
    const slot = new RunSlot();
    const stopped = slot.acquire();
    slot.drop();
    const next = slot.acquire();
    expect(next).toBeDefined();
    // The stopped request finishes later; that must not free the conversation under the new request.
    if (stopped) slot.release(stopped);
    expect(slot.acquire()).toBeUndefined();
    if (next) expect(slot.holds(next)).toBe(true);
  });
});

describe("OncePerKey", () => {
  it("skips a second call with the same key while the first is running", async () => {
    const once = new OncePerKey();
    let release: () => void = () => undefined;
    let calls = 0;
    const first = once.run("a", () => new Promise<void>((resolve) => { calls += 1; release = resolve; }));
    expect(await once.run("a", async () => { calls += 1; })).toBe(false);
    expect(await once.run("b", async () => { calls += 1; })).toBe(true);
    release();
    expect(await first).toBe(true);
    expect(calls).toBe(2);
    expect(await once.run("a", async () => { calls += 1; })).toBe(true);
  });

  it("frees the key when the action fails", async () => {
    const once = new OncePerKey();
    await expect(once.run("a", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await once.run("a", async () => undefined)).toBe(true);
  });
});
