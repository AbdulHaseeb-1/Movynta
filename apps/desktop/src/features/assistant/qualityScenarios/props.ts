import { SUBJECT_ID } from "./scoring";
import { group, kit } from "./commands";
import type { QualityScenario, ScenarioCommand } from "./types";

function sword(defect?: string): ScenarioCommand[] {
  const k = kit("sword");
  const bladeLength = defect === "stubby" ? 0.3 : defect === "club" ? 0.72 : 0.7;
  const bladeStart = defect === "club" ? 0.18 : defect === "detached-blade" ? 0.25 : 0.2;
  return [
    group("sword", "Sword", [defect === "off-center" ? 0.1 : 0, defect === "lifted" ? 0.3 : 0, 0]),
    k.sphere("pommel", "Pommel", 0.03, [0, 0.03, 0]),
    k.cylinder("grip", "Grip", 0.015, 0.12, [0, 0.12, 0]),
    ...(defect === "club" ? [] : [k.box("guard", "Crossguard", [0.14, 0.02, 0.03], [0, 0.19, 0])]),
    k.box("blade", "Blade", [0.05, bladeLength, 0.01], [0, bladeStart + bladeLength / 2, 0]),
  ];
}

export const SWORD: QualityScenario = {
  id: "sword",
  title: "One-handed sword",
  prompt: "Make a one-handed sword standing point-up with its pommel on the floor (y = 0), centered on the origin. One scene unit is one meter.",
  setup: [],
  checks: [
    { kind: "size", label: "Sword length", target: { id: SUBJECT_ID }, axis: "y", min: 0.88, max: 1.02 },
    { kind: "size", label: "Sword width", target: { id: SUBJECT_ID }, axis: "x", min: 0.1, max: 0.2 },
    { kind: "position", label: "Pommel on the floor", target: { id: SUBJECT_ID }, axis: "y", anchor: "min", min: -0.01, max: 0.01 },
    { kind: "position", label: "Centered left to right", target: { id: SUBJECT_ID }, axis: "x", anchor: "center", min: -0.02, max: 0.02 },
    { kind: "connected", label: "No loose parts", group: { id: SUBJECT_ID } },
  ],
  minimumParts: 4,
  defects: [
    { id: "detached-blade", description: "The blade hovers above the crossguard.", fails: ["No loose parts"] },
    { id: "stubby", description: "A blade less than half as long as it should be.", fails: ["Sword length"] },
    { id: "lifted", description: "The sword floats 0.3 above the floor.", fails: ["Pommel on the floor"] },
    { id: "off-center", description: "The sword is 0.1 to the side of the origin.", fails: ["Centered left to right"] },
    { id: "club", description: "A blade straight into the grip: no crossguard, and the blade is the full width.", fails: ["Sword width", "At least 4 separate parts"] },
  ],
  solution: sword,
};

function mug(defect?: string): ScenarioCommand[] {
  const k = kit("mug");
  const height = defect === "tall" ? 0.2 : 0.095;
  return [
    group("mug", "Mug", [0, defect === "sunk" ? -0.02 : 0, 0]),
    k.cylinder("body", "Body", defect === "wide" ? 0.06 : 0.04, height, [0, height / 2, 0]),
    ...(defect === "no-handle" ? [] : [k.torus("handle", "Handle", 0.025, 0.006, [defect === "floating-handle" ? 0.1 : 0.045, 0.0475, 0])]),
  ];
}

export const MUG: QualityScenario = {
  id: "mug",
  title: "Coffee mug",
  prompt: "Make a coffee mug with a handle, standing on the table at y = 0 and centered on the origin. One scene unit is one meter.",
  setup: [],
  checks: [
    { kind: "size", label: "Mug height", target: { id: SUBJECT_ID }, axis: "y", min: 0.085, max: 0.105 },
    { kind: "size", label: "Mug depth", target: { id: SUBJECT_ID }, axis: "z", min: 0.07, max: 0.09 },
    { kind: "size", label: "Mug width with handle", target: { id: SUBJECT_ID }, axis: "x", min: 0.09, max: 0.14 },
    { kind: "position", label: "Rests on the table", target: { id: SUBJECT_ID }, axis: "y", anchor: "min", min: -0.002, max: 0.002 },
    { kind: "connected", label: "No loose parts", group: { id: SUBJECT_ID } },
  ],
  minimumParts: 2,
  defects: [
    { id: "floating-handle", description: "The handle hangs in the air beside the cup.", fails: ["Mug width with handle", "No loose parts"] },
    { id: "tall", description: "A mug twice as tall as a mug.", fails: ["Mug height"] },
    { id: "no-handle", description: "A plain cup with no handle.", fails: ["Mug width with handle", "At least 2 separate parts"] },
    { id: "wide", description: "A bowl: 0.12 across.", fails: ["Mug depth"] },
    { id: "sunk", description: "The mug stands 0.02 below the table.", fails: ["Rests on the table"] },
  ],
  solution: mug,
};
