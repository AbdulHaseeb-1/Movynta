import { describe, expect, it, vi } from "vitest";
import { waitForAbortable } from "./waitForAbortable";

describe("waiting for shared work", () => {
  it("returns promptly on cancellation without cancelling shared work", async () => {
    let finish: ((value: string) => void) | undefined;
    const operation = new Promise<string>((resolve) => { finish = resolve; });
    const abort = new AbortController();
    const waiting = waitForAbortable(abort.signal, () => operation);
    abort.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    finish?.("finished");
    await expect(operation).resolves.toBe("finished");
  });
  it("does not start work after cancellation and preserves other failures", async () => {
    const abort = new AbortController(); abort.abort();
    const start = vi.fn(async () => 1);
    await expect(waitForAbortable(abort.signal, start)).rejects.toMatchObject({ name: "AbortError" });
    expect(start).not.toHaveBeenCalled();
    await expect(waitForAbortable(new AbortController().signal, () => Promise.reject(new Error("failure")))).rejects.toThrow("failure");
  });
});
