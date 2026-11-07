import { describe, expect, it, vi } from "vitest";
import { returnFocus } from "./dom";

describe("returning focus", () => {
  it("focuses the control that opened the dialog and takes over from the default", () => {
    const focus = vi.fn();
    const preventDefault = vi.fn();
    expect(returnFocus({ isConnected: true, focus }, { preventDefault })).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves focus alone when the control is gone, for example after its project was deleted", () => {
    const focus = vi.fn();
    const preventDefault = vi.fn();
    expect(returnFocus({ isConnected: false, focus }, { preventDefault })).toBe(false);
    expect(returnFocus(null, { preventDefault })).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
