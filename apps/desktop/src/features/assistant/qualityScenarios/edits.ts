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
  meshChecks: [{ kind: "closed", objectId: "block" }],
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

const BLOCK_SETUP: readonly ScenarioCommand[] = HALVE_BLOCK.setup;

/** Two cuts, each of which renumbers the mesh, so the second must be planned on the result of the first. */
export const QUARTER_BLOCK: QualityScenario = {
  id: "quarter-block",
  title: "Cut a block into a quarter",
  prompt: "Cut the Block into quarters across its width (x) and its depth (z), and keep only the quarter that has the largest x and the largest z. Keep it a closed solid.",
  setup: BLOCK_SETUP,
  checks: [
    { kind: "size", label: "Half as wide", target: { id: "block" }, axis: "x", min: 0.49, max: 0.51 },
    { kind: "size", label: "Half as deep", target: { id: "block" }, axis: "z", min: 0.49, max: 0.51 },
    { kind: "size", label: "Same height", target: { id: "block" }, axis: "y", min: 0.99, max: 1.01 },
    { kind: "position", label: "Right half kept", target: { id: "block" }, axis: "x", anchor: "min", min: -0.01, max: 0.01 },
    { kind: "position", label: "Front half kept", target: { id: "block" }, axis: "z", anchor: "min", min: -0.01, max: 0.01 },
  ],
  meshChecks: [
    { kind: "volume", objectId: "block", label: "A quarter of the volume", min: 0.24, max: 0.26 },
    { kind: "closed", objectId: "block" },
  ],
  defects: [
    { id: "one-cut", description: "Only the width was cut, so half the block remains.", fails: ["Half as deep", "Front half kept", "A quarter of the volume"] },
    { id: "depth-only", description: "Only the depth was cut, so half the block remains.", fails: ["Half as wide", "Right half kept", "A quarter of the volume"] },
    { id: "squashed", description: "Both cuts were made, then the block was squashed to half its height.", fails: ["Same height"] },
    { id: "wrong-corner", description: "The depth cut kept the back half instead of the front.", fails: ["Front half kept"] },
    { id: "open", description: "Both cuts were made without closing the openings.", fails: ["block is still a closed solid"] },
  ],
  solution(defect?: string): readonly ScenarioCommand[] {
    const cut = (axis: "x" | "z", keep: "positive" | "negative") => ({
      commandId: `cut-${axis}`, type: "geometry.bisect", objectId: "block", plane: { axis, offset: 0 }, space: "local", keep, fill: defect !== "open",
    });
    if (defect === "one-cut") return [cut("x", "positive")];
    if (defect === "depth-only") return [cut("z", "positive")];
    return [
      cut("x", "positive"), cut("z", defect === "wrong-corner" ? "negative" : "positive"),
      ...(defect === "squashed" ? [{ commandId: "squash", type: "scene.transform_object", objectId: "block", transform: { scale: [1, 0.5, 1] } }] : []),
    ];
  },
};

/** Needs a face found by its direction (the top cap), then deleted, which opens the mesh on purpose. */
export const OPEN_TUBE: QualityScenario = {
  id: "open-tube",
  title: "Open the top of a tube",
  prompt: "Remove the top cap of the Tube so that it is open at the top. Keep the sides and the bottom as they are.",
  setup: [
    { commandId: "make-tube", type: "geometry.create_primitive", objectId: "tube", primitive: "cylinder", size: 1, replaceExisting: false, name: "Tube",
      options: { radiusTop: 0.25, radiusBottom: 0.25, height: 1, radialSegments: 16 }, transform: { position: [0, 0.5, 0] } },
  ],
  checks: [
    { kind: "size", label: "Same height", target: { id: "tube" }, axis: "y", min: 0.99, max: 1.01 },
    { kind: "size", label: "Same width", target: { id: "tube" }, axis: "x", min: 0.49, max: 0.51 },
  ],
  meshChecks: [
    { kind: "openings", objectId: "tube", label: "One opening", count: 1 },
    { kind: "opening-at", objectId: "tube", label: "Open at the top", axis: "y", min: 0.95, max: 1.05 },
    { kind: "faces", objectId: "tube", label: "Sides and bottom kept", min: 17, max: 17 },
  ],
  defects: [
    { id: "bottom-removed", description: "The bottom cap was removed instead of the top.", fails: ["Open at the top"] },
    { id: "side-removed", description: "A panel of the side was removed, leaving a window.", fails: ["Open at the top"] },
    { id: "both-caps", description: "Both caps were removed, leaving a pipe.", fails: ["One opening", "Sides and bottom kept"] },
    { id: "untouched", description: "Nothing was removed.", fails: ["One opening", "Open at the top", "Sides and bottom kept"] },
    { id: "narrowed", description: "The top was removed but the tube was also squeezed to half its width.", fails: ["Same width"] },
    { id: "squashed", description: "The top was removed but the tube was also squashed to half its height.", fails: ["Same height", "Open at the top"] },
  ],
  solution(defect?: string): readonly ScenarioCommand[] {
    // The top cap is face 16 and the bottom cap face 17 of a 16-sided cylinder; the sides are 0 to 15.
    const faces = defect === "untouched" ? [] : defect === "bottom-removed" ? ["17"] : defect === "side-removed" ? ["0"] : defect === "both-caps" ? ["16", "17"] : ["16"];
    const scale = defect === "narrowed" ? [0.5, 1, 1] : defect === "squashed" ? [1, 0.5, 1] : undefined;
    return [
      ...(faces.length > 0 ? [{ commandId: "remove", type: "geometry.delete_components", objectId: "tube", kind: "face", ids: faces }] : []),
      ...(scale ? [{ commandId: "squeeze", type: "scene.transform_object", objectId: "tube", transform: { scale } }] : []),
    ];
  },
};

/** Faces that point inward give a mesh a negative volume; the shape is right and the surface is wrong. */
export const INSIDE_OUT: QualityScenario = {
  id: "inside-out",
  title: "Fix an inside-out crate",
  prompt: "The Crate looks inside out: its faces point inward. Make them point outward, without changing its shape.",
  setup: [
    { commandId: "make-crate", type: "geometry.create_primitive", objectId: "crate", primitive: "box", size: 1, replaceExisting: false, name: "Crate", transform: { position: [0, 0.5, 0] } },
    { commandId: "turn-inside-out", type: "geometry.flip_normals", objectId: "crate" },
  ],
  checks: [
    { kind: "size", label: "Same height", target: { id: "crate" }, axis: "y", min: 0.99, max: 1.01 },
  ],
  meshChecks: [
    { kind: "volume", objectId: "crate", label: "Faces point outward", min: 0.99, max: 1.01 },
    { kind: "closed", objectId: "crate", label: "Still closed" },
  ],
  defects: [
    { id: "untouched", description: "Nothing was changed.", fails: ["Faces point outward"] },
    { id: "squashed", description: "The faces were flipped but the crate was squashed to half its height.", fails: ["Same height"] },
    { id: "holed", description: "The faces were flipped but a face was deleted.", fails: ["Faces point outward", "Still closed"] },
  ],
  solution(defect?: string): readonly ScenarioCommand[] {
    if (defect === "untouched") return [];
    return [
      { commandId: "flip", type: "geometry.flip_normals", objectId: "crate" },
      ...(defect === "squashed" ? [{ commandId: "squash", type: "scene.transform_object", objectId: "crate", transform: { scale: [1, 0.5, 1] } }] : []),
      ...(defect === "holed" ? [{ commandId: "hole", type: "geometry.delete_components", objectId: "crate", kind: "face", ids: ["0"] }] : []),
    ];
  },
};
