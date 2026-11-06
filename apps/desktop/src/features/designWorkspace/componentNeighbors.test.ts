import { BufferGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { changeComponentSelection } from "./componentNeighbors";
import type { ComponentGeometry } from "./componentGeometry";

const data: ComponentGeometry = {
  mesh: { positions: Array.from({ length: 10 }, () => new Vector3()), faces: [[0, 1, 4, 3], [1, 2, 5, 4], [6, 7, 8, 9]] },
  picking: new BufferGeometry(), triangleFaces: [], faceTriangleOffsets: new Uint32Array(),
  edges: new Map([["0_1", [0, 1]], ["1_4", [1, 4]], ["3_4", [3, 4]], ["0_3", [0, 3]], ["1_2", [1, 2]], ["2_5", [2, 5]], ["4_5", [4, 5]], ["6_7", [6, 7]], ["7_8", [7, 8]], ["8_9", [8, 9]], ["6_9", [6, 9]]]),
};

describe("component selection by topology", () => {
  it("grows by one ring and finds only connected components", () => {
    expect(new Set(changeComponentSelection(data, "vertex", ["0"], "grow"))).toEqual(new Set(["0", "1", "3"]));
    expect(new Set(changeComponentSelection(data, "vertex", ["0"], "connected"))).toEqual(new Set(["0", "1", "2", "3", "4", "5"]));
    expect(changeComponentSelection(data, "face", ["0"], "connected")).toEqual(["0", "1"]);
    expect(new Set(changeComponentSelection(data, "edge", ["0_1"], "grow"))).toEqual(new Set(["0_1", "0_3", "1_4", "1_2"]));
  });
  it("shrinks against unselected neighbors", () => {
    expect(changeComponentSelection(data, "vertex", ["0", "1", "3"], "shrink")).toEqual(["0"]);
    expect(changeComponentSelection(data, "face", ["0", "1"], "shrink")).toEqual(["0", "1"]);
  });
});
