import { SUBJECT_ID } from "./scoring";
import { group, kit } from "./commands";
import type { QualityScenario, ScenarioCommand } from "./types";

function figure(defect?: string): ScenarioCommand[] {
  const k = kit("figure", defect === "giant" ? 1.5 : 1);
  const headLift = defect === "floating-head" ? 0.08 : 0;
  const root = group("figure", "Figure", [defect === "off-center" ? 0.3 : 0, defect === "sunk" ? -0.15 : 0, 0]);
  if (defect === "one-block") return [root, k.box("body", "Body", [0.4, 1.75, 0.2], [0, 0.875, 0])];
  return [
    root,
    k.cylinder("leg_l", "Leg.L", 0.08, 0.85, [-0.1, 0.425, 0]),
    k.cylinder("leg_r", "Leg.R", 0.08, 0.85, [0.1, 0.425, 0]),
    k.box("torso", "Torso", [0.4, 0.6, 0.2], [0, 1.15, 0]),
    k.box("arm_l", "Arm.L", [0.08, 0.55, 0.08], [-0.24, 1.15, 0]),
    k.box("arm_r", "Arm.R", [0.08, 0.55, 0.08], [0.24, 1.15, 0]),
    k.sphere("head", "Head", 0.15, [0, 1.6 + headLift, 0]),
  ];
}

export const FIGURE: QualityScenario = {
  id: "figure",
  title: "Human figure blockout",
  prompt: "Block out a standing adult human figure, about 1.75 meters tall, with its feet on the floor and centered on the origin. One scene unit is one meter.",
  setup: [],
  checks: [
    { kind: "size", label: "Figure height", target: { id: SUBJECT_ID }, axis: "y", min: 1.6, max: 1.85 },
    { kind: "size", label: "Figure width", target: { id: SUBJECT_ID }, axis: "x", min: 0.4, max: 0.7 },
    { kind: "size", label: "Figure depth", target: { id: SUBJECT_ID }, axis: "z", min: 0.15, max: 0.4 },
    { kind: "position", label: "Standing on the floor", target: { id: SUBJECT_ID }, axis: "y", anchor: "min", min: -0.01, max: 0.01 },
    { kind: "position", label: "Centered left to right", target: { id: SUBJECT_ID }, axis: "x", anchor: "center", min: -0.05, max: 0.05 },
    { kind: "connected", label: "No loose parts", group: { id: SUBJECT_ID } },
  ],
  minimumParts: 6,
  defects: [
    { id: "floating-head", description: "The head hovers above the shoulders.", fails: ["No loose parts"] },
    { id: "one-block", description: "One tall block with the right outline and no body parts.", fails: ["At least 6 separate parts"] },
    { id: "giant", description: "The whole figure is 1.5 times too large.", fails: ["Figure height", "Figure width", "Figure depth"] },
    { id: "sunk", description: "The figure stands knee-deep in the floor.", fails: ["Standing on the floor"] },
    { id: "off-center", description: "The figure stands 0.3 to the side of the origin.", fails: ["Centered left to right"] },
  ],
  solution: figure,
};
