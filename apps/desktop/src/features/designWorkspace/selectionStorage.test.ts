import { afterEach, expect, it, vi } from "vitest";
import { loadComponentSelection, saveComponentSelection } from "./selectionStorage";

afterEach(() => vi.unstubAllGlobals());
it("stores project selections separately and rejects malformed data", () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  const selection = { objectId: "box", kind: "face" as const, path: [], ids: ["1"], key: "0123456789abcdef" };
  saveComponentSelection("one", selection);
  expect(loadComponentSelection("one")).toEqual(selection);
  expect(loadComponentSelection("two")).toBeNull();
  entries.set("movynta.project.selection.v1.one", '{"ids":["wrong"]}');
  expect(loadComponentSelection("one")).toBeNull();
});
