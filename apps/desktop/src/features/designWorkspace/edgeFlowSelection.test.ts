import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { selectEdgeFlow } from "./edgeFlowSelection";
import type { PolygonMesh } from "@/features/meshGeometry/meshTopology";

const mesh: PolygonMesh = {
  positions: Array.from({ length: 16 }, (_, index) => new Vector3(index % 4, Math.floor(index / 4), 0)),
  faces: Array.from({ length: 9 }, (_, index) => {
    const a = Math.floor(index / 3) * 4 + index % 3;
    return [a, a + 1, a + 5, a + 4];
  }),
};

describe("edge flow selection", () => {
  it("follows a loop through regular quad vertices and stops at boundaries", () => {
    expect(new Set(selectEdgeFlow(mesh, ["5_6"], "loop"))).toEqual(new Set(["4_5", "5_6", "6_7"]));
  });
  it("follows opposite edges across quad faces", () => {
    expect(new Set(selectEdgeFlow(mesh, ["5_6"], "ring"))).toEqual(new Set(["1_2", "5_6", "9_10", "13_14"]));
  });
});
