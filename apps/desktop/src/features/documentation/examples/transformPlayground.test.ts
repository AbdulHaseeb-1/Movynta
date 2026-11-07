import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAYGROUND,
  INITIAL_SHAPE,
  previewShape,
  transformReducer,
  transformStatus,
  type PlaygroundAction,
  type TransformPlayground,
} from "./transformPlayground";

function run(...actions: PlaygroundAction[]): TransformPlayground {
  return actions.reduce(transformReducer, INITIAL_PLAYGROUND);
}

const origin = { x: 1, y: 0 };

describe("transform playground", () => {
  it("previews a move with the pointer and changes nothing until confirmed", () => {
    const moving = run({ type: "start", operation: "move", pointer: origin }, { type: "pointer", pointer: { x: 3, y: 2 } });
    expect(previewShape(moving)).toMatchObject({ x: 2, y: 2 });
    expect(moving.shape).toEqual(INITIAL_SHAPE);
    expect(transformReducer(moving, { type: "cancel" }).shape).toEqual(INITIAL_SHAPE);
    expect(transformReducer(moving, { type: "confirm" }).shape).toMatchObject({ x: 2, y: 2 });
  });

  it("constrains to an axis and releases it on the same key", () => {
    const constrained = run({ type: "start", operation: "move", pointer: origin }, { type: "axis", axis: "x" }, { type: "pointer", pointer: { x: 3, y: 2 } });
    expect(previewShape(constrained)).toMatchObject({ x: 2, y: 0 });
    expect(previewShape(transformReducer(constrained, { type: "axis", axis: "x" }))).toMatchObject({ x: 2, y: 2 });
  });

  it("moves an exact typed distance, along X when no axis is chosen", () => {
    const typed = run({ type: "start", operation: "move", pointer: origin }, { type: "pointer", pointer: { x: 9, y: 9 } }, { type: "type", text: "-" }, { type: "type", text: "2" }, { type: "type", text: "." }, { type: "type", text: "5" });
    expect(previewShape(typed)).toMatchObject({ x: -2.5, y: 0 });
    expect(transformStatus(typed)).toContain("Move · -2.5");
    expect(previewShape(transformReducer(typed, { type: "axis", axis: "y" }))).toMatchObject({ x: 0, y: -2.5 });
  });

  it("rejects characters that would not make a number", () => {
    const typed = run({ type: "start", operation: "move", pointer: origin }, { type: "type", text: "1" }, { type: "type", text: "-" }, { type: "type", text: "." }, { type: "type", text: "." });
    expect(typed.session?.numeric).toBe("1.");
    expect(transformReducer(typed, { type: "backspace" }).session?.numeric).toBe("1");
  });

  it("rotates by a typed angle and keeps it between -180 and 180", () => {
    const turned = run({ type: "start", operation: "rotate", pointer: origin }, { type: "type", text: "2" }, { type: "type", text: "7" }, { type: "type", text: "0" }, { type: "confirm" });
    expect(turned.shape.rotation).toBe(-90);
  });

  it("rotates with the pointer around the shape", () => {
    const turned = run({ type: "start", operation: "rotate", pointer: { x: 1, y: 0 } }, { type: "pointer", pointer: { x: 0, y: 1 } });
    expect(previewShape(turned).rotation).toBeCloseTo(90);
  });

  it("refuses scale factors outside 0.001 to 100", () => {
    const tooBig = run({ type: "start", operation: "scale", pointer: origin }, { type: "type", text: "2" }, { type: "type", text: "0" }, { type: "type", text: "0" });
    expect(transformStatus(tooBig)).toContain("from 0.001 to 100");
    expect(transformReducer(tooBig, { type: "confirm" }).session).not.toBeNull();
    const fine = transformReducer(transformReducer(tooBig, { type: "backspace" }), { type: "confirm" });
    expect(fine.shape).toMatchObject({ scaleX: 20, scaleY: 20 });
  });

  it("scales one axis with the pointer", () => {
    const stretched = run({ type: "start", operation: "scale", pointer: { x: 1, y: 0 } }, { type: "axis", axis: "x" }, { type: "pointer", pointer: { x: 2, y: 0 } });
    expect(previewShape(stretched)).toMatchObject({ scaleX: 2, scaleY: 1 });
  });

  it("ignores G, R and S while a transform runs, as the workspace does", () => {
    const moving = run({ type: "start", operation: "move", pointer: origin });
    expect(transformReducer(moving, { type: "start", operation: "scale", pointer: origin })).toBe(moving);
  });

  it("undoes confirmed edits in order", () => {
    const twice = run(
      { type: "start", operation: "move", pointer: origin }, { type: "type", text: "1" }, { type: "confirm" },
      { type: "start", operation: "move", pointer: origin }, { type: "type", text: "2" }, { type: "confirm" },
    );
    expect(twice.shape.x).toBe(3);
    const once = transformReducer(twice, { type: "undo" });
    expect(once.shape.x).toBe(1);
    expect(transformReducer(transformReducer(once, { type: "undo" }), { type: "undo" }).message).toBe("Nothing to undo.");
  });
});
