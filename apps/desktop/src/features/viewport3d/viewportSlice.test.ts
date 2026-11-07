import { afterEach, describe, expect, it, vi } from "vitest";
import { setShadingMode, setXray, toggleWireframe, toggleXray, viewportReducer, xrayActive, type ViewportState } from "./viewportSlice";
import { DEFAULT_VIEWPORT_DISPLAY, loadViewportDisplay, saveViewportDisplay } from "./viewportStorage";

const start = (): ViewportState => ({ tool: "select", display: { ...DEFAULT_VIEWPORT_DISPLAY } });

describe("viewport display", () => {
  it("returns from Wireframe to the shading used before it", () => {
    let state = viewportReducer(start(), setShadingMode("solid"));
    state = viewportReducer(state, toggleWireframe());
    expect(state.display.shadingMode).toBe("wireframe");
    state = viewportReducer(state, toggleWireframe());
    expect(state.display.shadingMode).toBe("solid");
  });

  it("uses X-ray in Solid and Wireframe, and switches Material to Solid to turn it on", () => {
    let state = viewportReducer(start(), toggleXray());
    expect(state.display).toMatchObject({ shadingMode: "solid", xray: true });
    expect(xrayActive(state.display)).toBe(true);
    state = viewportReducer(state, setShadingMode("wireframe"));
    expect(xrayActive(state.display)).toBe(true);
    state = viewportReducer(state, setShadingMode("default"));
    expect(xrayActive(state.display)).toBe(false);
    state = viewportReducer(viewportReducer(state, setShadingMode("solid")), toggleXray());
    expect(state.display.xray).toBe(false);
    expect(viewportReducer(state, setXray(true)).display.xray).toBe(true);
  });
});

describe("saved viewport display", () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  };
  afterEach(() => { vi.unstubAllGlobals(); stored.clear(); });

  it("keeps the last choice across restarts", () => {
    vi.stubGlobal("localStorage", storage);
    saveViewportDisplay({ shadingMode: "wireframe", xray: true, showGrid: false, lastShadedMode: "solid" });
    expect(loadViewportDisplay()).toEqual({ shadingMode: "wireframe", xray: true, showGrid: false, lastShadedMode: "solid" });
  });

  it("ignores damaged values and falls back when storage is unavailable", () => {
    vi.stubGlobal("localStorage", storage);
    stored.set("movynta.viewport.display.v1", JSON.stringify({ shadingMode: "toon", xray: "yes", showGrid: false, lastShadedMode: "wireframe" }));
    expect(loadViewportDisplay()).toEqual({ ...DEFAULT_VIEWPORT_DISPLAY, showGrid: false });
    stored.set("movynta.viewport.display.v1", "{not json");
    expect(loadViewportDisplay()).toEqual(DEFAULT_VIEWPORT_DISPLAY);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(loadViewportDisplay()).toEqual(DEFAULT_VIEWPORT_DISPLAY);
  });
});
