import { describe, expect, it } from "vitest";
import { chordFromEvent, chordKeys, chordsOf, parseKeyGroups, parseKeys, stepChord, type KeyPress } from "./keys";

function press(overrides: Partial<KeyPress> & Pick<KeyPress, "key">): KeyPress {
  return { code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe("parseKeys", () => {
  it("reads chords, pointer actions and labels", () => {
    expect(parseKeys("Ctrl+Shift+Z / Mesh menu / Space + Drag")).toEqual([
      { kind: "keys", steps: [[{ kind: "key", key: "Ctrl", modifier: true }, { kind: "key", key: "Shift", modifier: true }, { kind: "key", key: "Z", modifier: false }]] },
      { kind: "label", text: "Mesh menu" },
      { kind: "keys", steps: [[{ kind: "key", key: "Space", modifier: false }, { kind: "pointer", action: "Drag" }]] },
    ]);
  });

  it("treats a lone plus and the minus sign as keys", () => {
    expect(chordsOf("Scroll / = / + / −")).toEqual(["=", "+", "−"]);
    expect(chordsOf("-")).toEqual(["−"]);
  });

  it("reads sequences with then", () => {
    const [box] = parseKeys("B then Drag");
    expect(box?.kind === "keys" && box.steps.length).toBe(2);
    expect(chordsOf("B then Drag")).toEqual(["B"]);
  });

  it("keeps groups apart from alternatives", () => {
    expect(parseKeyGroups("Enter / Click · Esc / Right-click").map((group) => group.length)).toEqual([2, 2]);
  });

  it("normalizes key names", () => {
    expect(chordsOf("esc / numpad1 / f2 / a")).toEqual(["Esc", "Numpad 1", "F2", "A"]);
  });
});

describe("stepChord", () => {
  it("orders modifiers and ignores pointer and modifier-only steps", () => {
    const [shiftCtrl] = parseKeys("Shift+Ctrl+B");
    expect(shiftCtrl?.kind === "keys" && stepChord(shiftCtrl.steps[0] ?? [])).toBe("Ctrl+Shift+B");
    expect(chordsOf("Shift+Click / Shift / Ctrl")).toEqual([]);
  });
});

describe("chordFromEvent", () => {
  it("names letters by their key position, with modifiers", () => {
    expect(chordFromEvent(press({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Z");
    expect(chordFromEvent(press({ key: "Ω", code: "KeyZ", altKey: true }))).toBe("Alt+Z");
  });

  it("counts Command as Ctrl", () => {
    expect(chordFromEvent(press({ key: "z", code: "KeyZ", metaKey: true }))).toBe("Ctrl+Z");
  });

  it("tells numpad digits from the digit row", () => {
    expect(chordFromEvent(press({ key: "1", code: "Numpad1" }))).toBe("Numpad 1");
    expect(chordFromEvent(press({ key: "End", code: "Numpad1" }))).toBe("Numpad 1");
    expect(chordFromEvent(press({ key: "1", code: "Digit1" }))).toBe("1");
  });

  it("leaves Shift out of symbols it types", () => {
    expect(chordFromEvent(press({ key: "?", code: "Slash", shiftKey: true }))).toBe("?");
    expect(chordFromEvent(press({ key: "+", code: "Equal", shiftKey: true }))).toBe("+");
  });

  it("names special keys as the guide writes them", () => {
    expect(chordFromEvent(press({ key: "Escape", code: "Escape" }))).toBe("Esc");
    expect(chordFromEvent(press({ key: " ", code: "Space" }))).toBe("Space");
    expect(chordFromEvent(press({ key: "ArrowLeft", code: "ArrowLeft" }))).toBe("←");
    expect(chordFromEvent(press({ key: "F1", code: "F1" }))).toBe("F1");
  });

  it("waits while only modifiers are held", () => {
    expect(chordFromEvent(press({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeUndefined();
  });
});

describe("chordKeys", () => {
  it("splits chords, including a plus key", () => {
    expect(chordKeys("Ctrl+Shift+Z")).toEqual(["Ctrl", "Shift", "Z"]);
    expect(chordKeys("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(chordKeys("+")).toEqual(["+"]);
  });
});
