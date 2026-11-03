import { afterEach, expect, it, vi } from "vitest";
import { loadPanelVisibility, savePanelVisibility } from "./panelStorage";

afterEach(() => vi.unstubAllGlobals());
it("persists the open state of every workspace panel and restores only valid values", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const saved = {
    assistant: true,
    scene: false,
    meshSelection: true,
    modifiers: true,
    properties: false,
  };
  savePanelVisibility(saved);
  expect(loadPanelVisibility()).toEqual(saved);
  values.set(
    "movynta.workspace.panels.v1",
    '{"scene":true,"assistant":"bad","unknown":true}',
  );
  expect(loadPanelVisibility()).toEqual({
    assistant: false,
    scene: true,
    meshSelection: false,
    modifiers: false,
    properties: false,
  });
});
it("uses defaults when storage is unavailable or corrupt", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    },
  });
  const defaults = loadPanelVisibility();
  expect(Object.values(defaults).every((value) => !value)).toBe(true);
  expect(() => savePanelVisibility(defaults)).not.toThrow();
});
