import { SUBJECT_ID } from "./scoring";
import { group, kit } from "./commands";
import type { QualityScenario, ScenarioCommand } from "./types";

const FLOOR = { min: -0.01, max: 0.01 } as const;

function chair(defect?: string): ScenarioCommand[] {
  const k = kit("chair", defect === "tiny" ? 0.5 : 1);
  const root = group("chair", "Chair", [defect === "off-center" ? 0.3 : 0, defect === "sunk" ? -0.2 : 0, 0]);
  if (defect === "single-block") return [root, k.box("body", "Body", [0.45, 0.85, 0.45], [0, 0.425, 0])];
  const lift = defect === "floating-back" ? 0.15 : 0;
  return [
    root,
    k.box("seat", "Seat", [0.45, 0.04, 0.45], [0, 0.43, 0]),
    k.box("leg_fl", "Leg.FL", [0.04, 0.41, 0.04], [-0.2, 0.205, 0.2]),
    k.box("leg_fr", "Leg.FR", [0.04, 0.41, 0.04], [0.2, 0.205, 0.2]),
    k.box("leg_bl", "Leg.BL", [0.04, 0.41, 0.04], [-0.2, 0.205, -0.2]),
    k.box("leg_br", "Leg.BR", [0.04, 0.41, 0.04], [0.2, 0.205, -0.2]),
    k.box("back", "Backrest", [0.45, 0.4, 0.04], [0, 0.65 + lift, -0.205]),
  ];
}

export const CHAIR: QualityScenario = {
  id: "chair",
  title: "Dining chair",
  prompt: "Make a simple wooden dining chair, standing on the floor and centered on the origin. One scene unit is one meter.",
  setup: [],
  checks: [
    { kind: "size", label: "Chair height", target: { id: SUBJECT_ID }, axis: "y", min: 0.75, max: 1.05 },
    { kind: "size", label: "Chair width", target: { id: SUBJECT_ID }, axis: "x", min: 0.35, max: 0.6 },
    { kind: "size", label: "Chair depth", target: { id: SUBJECT_ID }, axis: "z", min: 0.35, max: 0.6 },
    { kind: "position", label: "Rests on the floor", target: { id: SUBJECT_ID }, axis: "y", anchor: "min", ...FLOOR },
    { kind: "position", label: "Centered left to right", target: { id: SUBJECT_ID }, axis: "x", anchor: "center", min: -0.05, max: 0.05 },
    { kind: "connected", label: "No loose parts", group: { id: SUBJECT_ID } },
  ],
  minimumParts: 6,
  defects: [
    { id: "tiny", description: "The whole chair is half size, a doll's chair.", fails: ["Chair height", "Chair width", "Chair depth"] },
    { id: "sunk", description: "The chair stands 0.2 below the floor.", fails: ["Rests on the floor"] },
    { id: "floating-back", description: "The backrest hovers above the seat.", fails: ["No loose parts"] },
    { id: "off-center", description: "The chair stands 0.3 to the side of the origin.", fails: ["Centered left to right"] },
    { id: "single-block", description: "One block with the right outline and no legs, seat or back.", fails: ["At least 6 separate parts"] },
  ],
  solution: chair,
};

function table(defect?: string): ScenarioCommand[] {
  const root = group("table", "Table", [defect === "off-center" ? 0.4 : 0, 0, 0]);
  const k = kit("table");
  if (defect === "legless") return [root, k.box("top", "Tabletop", [1.4, 0.04, 0.8], [0, 0.72, 0])];
  // A small square table has a top 0.6 across, with its legs moved in to match.
  const [length, width] = defect === "small" ? [0.6, 0.6] : [1.4, 0.8];
  const legX = length / 2 - 0.06, legZ = width / 2 - 0.06;
  // Legs run from the floor to the underside of the top, which sits 0.04 below the working surface.
  const legHeight = defect === "short-legs" ? 0.5 : defect === "too-high" ? 1.06 : 0.7;
  const topCenter = defect === "too-high" ? 1.08 : 0.72;
  const leg = (id: string, name: string, x: number, z: number) => k.box(id, name, [0.06, legHeight, 0.06], [x, legHeight / 2, z]);
  return [
    root,
    k.box("top", "Tabletop", [length, 0.04, width], [0, topCenter, 0]),
    leg("leg_fl", "Leg.FL", -legX, legZ), leg("leg_fr", "Leg.FR", legX, legZ),
    leg("leg_bl", "Leg.BL", -legX, -legZ), leg("leg_br", "Leg.BR", legX, -legZ),
  ];
}

export const TABLE: QualityScenario = {
  id: "table",
  title: "Dining table",
  prompt: "Make a dining table for four people, standing on the floor and centered on the origin. One scene unit is one meter.",
  setup: [],
  checks: [
    { kind: "size", label: "Table height", target: { id: SUBJECT_ID }, axis: "y", min: 0.7, max: 0.78 },
    { kind: "size", label: "Table length", target: { id: SUBJECT_ID }, axis: "x", min: 1.2, max: 1.8 },
    { kind: "size", label: "Table width", target: { id: SUBJECT_ID }, axis: "z", min: 0.7, max: 1.0 },
    { kind: "position", label: "Rests on the floor", target: { id: SUBJECT_ID }, axis: "y", anchor: "min", ...FLOOR },
    { kind: "position", label: "Centered left to right", target: { id: SUBJECT_ID }, axis: "x", anchor: "center", min: -0.05, max: 0.05 },
    { kind: "connected", label: "No loose parts", group: { id: SUBJECT_ID } },
  ],
  minimumParts: 5,
  defects: [
    { id: "short-legs", description: "The legs stop short and the top floats above them.", fails: ["No loose parts"] },
    { id: "too-high", description: "A bar-height table, 1.1 tall.", fails: ["Table height"] },
    { id: "small", description: "A small square table, 0.6 across.", fails: ["Table length", "Table width"] },
    { id: "off-center", description: "The table stands 0.4 to the side of the origin.", fails: ["Centered left to right"] },
    { id: "legless", description: "A top floating at table height with nothing under it.", fails: ["Table height", "Rests on the floor", "At least 5 separate parts"] },
  ],
  solution: table,
};
