import type { QualityScenario, ScenarioCommand } from "./types";

const BLOCK = { kind: "size" } as const;

export const HALVE_BLOCK: QualityScenario = {
  id: "halve-block",
  title: "Cut a block in half",
  prompt: "Cut the Block exactly in half across its width (the x direction) and remove the left half. Keep the right half as a closed solid.",
  setup: [
    { commandId: "make-block", type: "geometry.create_primitive", objectId: "block", primitive: "box", size: 1, replaceExisting: false, name: "Block", transform: { position: [0, 0.5, 0] } },
  ],
  checks: [
    { ...BLOCK, label: "Half as wide", target: { id: "block" }, axis: "x", min: 0.49, max: 0.51 },
    { ...BLOCK, label: "Same height", target: { id: "block" }, axis: "y", min: 0.99, max: 1.01 },
    { ...BLOCK, label: "Same depth", target: { id: "block" }, axis: "z", min: 0.99, max: 1.01 },
    { kind: "position", label: "Left half removed", target: { id: "block" }, axis: "x", anchor: "min", min: -0.01, max: 0.01 },
  ],
  closed: ["block"],
  defects: [
    { id: "wrong-side", description: "The right half was removed instead of the left.", fails: ["Left half removed"] },
    { id: "uncut", description: "Nothing was cut.", fails: ["Half as wide", "Left half removed"] },
    { id: "flattened", description: "The block was squashed to half its width and half its height instead of cut.", fails: ["Same height", "Left half removed"] },
    { id: "wrong-axis", description: "The block was cut across its depth instead of its width.", fails: ["Half as wide", "Same depth", "Left half removed"] },
    { id: "open", description: "The cut was made without closing the opening.", fails: ["block is still a closed solid"] },
  ],
  solution(defect?: string): readonly ScenarioCommand[] {
    if (defect === "uncut") return [];
    if (defect === "flattened") return [{ commandId: "squash", type: "scene.transform_object", objectId: "block", transform: { scale: [0.5, 0.5, 1] } }];
    const plane = defect === "wrong-axis" ? { axis: "z", offset: 0 } : { axis: "x", offset: 0 };
    return [{
      commandId: "cut", type: "geometry.bisect", objectId: "block", plane, space: "local",
      keep: defect === "wrong-side" ? "negative" : "positive", fill: defect !== "open",
    }];
  },
};
