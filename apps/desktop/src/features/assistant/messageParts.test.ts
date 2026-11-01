import { describe, expect, it } from "vitest";
import { buildParts } from "./messageParts";
import type { ChatMessage } from "./types";

const base: ChatMessage = {
  id: "m",
  role: "assistant",
  content: "",
  state: "done",
  activity: [],
  startedAt: 0,
};

describe("buildParts", () => {
  it("places steps between the text written before and after them", () => {
    const parts = buildParts({
      ...base,
      content: "Looking. Done.",
      activity: [
        {
          id: "tool-0",
          kind: "tool",
          label: "Reading the scene",
          status: "done",
          contentOffset: 9,
        },
      ],
    });
    expect(parts.map((part) => part.kind)).toEqual(["text", "step", "text"]);
    expect(parts[0]).toMatchObject({ text: "Looking. " });
    expect(parts[2]).toMatchObject({ text: "Done." });
  });

  it("clamps offsets that point past the text", () => {
    const parts = buildParts({
      ...base,
      content: "Hi",
      activity: [
        {
          id: "tool-0",
          kind: "tool",
          label: "x",
          status: "done",
          contentOffset: 99,
        },
      ],
    });
    expect(parts.map((part) => part.kind)).toEqual(["text", "step"]);
  });
});
