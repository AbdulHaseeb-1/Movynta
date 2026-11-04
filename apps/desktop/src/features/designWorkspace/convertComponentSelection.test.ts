import { describe, expect, it } from "vitest";
import { BoxGeometry } from "three";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { convertComponentSelection } from "./convertComponentSelection";

describe("component selection conversion", () => {
  it("converts one cube face to its edges and vertices, and back", () => {
    const mesh = readTopology(new BoxGeometry());
    const vertices = convertComponentSelection(mesh, "face", "vertex", ["0"]);
    const edges = convertComponentSelection(mesh, "face", "edge", ["0"]);
    expect(vertices).toHaveLength(4);
    expect(edges).toHaveLength(4);
    expect(convertComponentSelection(mesh, "vertex", "face", vertices)).toEqual(["0"]);
    expect(convertComponentSelection(mesh, "edge", "face", edges)).toEqual(["0"]);
  });
});
