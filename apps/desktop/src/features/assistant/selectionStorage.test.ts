import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptySelection,
  loadSelection,
  saveSelection,
} from "./selectionStorage";

function stubStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set("movynta.assistantSelection", initial);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("assistant selection storage", () => {
  it("round-trips the provider and model", () => {
    stubStorage();
    saveSelection({
      providerId: "anthropic",
      model: "claude-sonnet-5-5",
      efforts: { "anthropic:claude-sonnet-5-5": "high" },
    });
    expect(loadSelection()).toEqual({
      providerId: "anthropic",
      model: "claude-sonnet-5-5",
      efforts: { "anthropic:claude-sonnet-5-5": "high" },
    });
  });

  it("loads selections saved before efforts existed", () => {
    stubStorage(JSON.stringify({ providerId: "openai", model: "gpt-5" }));
    expect(loadSelection()).toEqual({
      providerId: "openai",
      model: "gpt-5",
      efforts: {},
    });
  });

  it("ignores malformed or unknown data", () => {
    stubStorage("not json");
    expect(loadSelection()).toEqual(emptySelection);
    stubStorage(JSON.stringify({ providerId: "nope", model: "x" }));
    expect(loadSelection()).toEqual(emptySelection);
  });

  it("falls back when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadSelection()).toEqual(emptySelection);
    expect(() => saveSelection(emptySelection)).not.toThrow();
  });
});
