import { describe, expect, it } from "vitest";
import { Mesh, Scene, Vector3, type Object3D } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { createPolygonMesh } from "./createPolygonMesh";
import { readTopology } from "./meshTopology";
import { distanceGroups, mergeByDistance } from "./meshMergeDistance";

function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }
function source() { return createPolygonMesh([[0,0,0],[0.1,0,0],[1,1,0],[0,1,0],[3,0,0],[3.1,0,0],[4,1,0],[3,1,0]], [[0,1,2,3],[4,5,6,7]]); }
describe("merge by distance", () => {
  it("merges separate groups together in one validated result", () => {
    const mesh = readTopology(source());
    expect(distanceGroups(mesh, ["0", "1", "4", "5"], 0.2)).toEqual([[0, 1], [4, 5]]);
    const result = mergeByDistance(mesh, ["0", "1", "4", "5"], 0.2);
    expect(result.mesh.positions).toHaveLength(6);
    expect(result.mesh.faces.map((face) => face.length)).toEqual([3, 3]);
    expect(result.selection).toHaveLength(2);
  });
  it("uses connected links and ignores unselected vertices", () => {
    const mesh = { positions: [0, 0.09, 0.18, 0.27].map((x) => new Vector3(x, 0, 0)), faces: [] };
    expect(distanceGroups(mesh, ["0", "1", "2"], 0.1)).toEqual([[0, 1, 2]]);
    expect(distanceGroups(mesh, ["0", "2"], 0.1)).toEqual([]);
  });
  it("rejects no matches, invalid distances, and a complete collapse", () => {
    const mesh = readTopology(source());
    expect(() => mergeByDistance(mesh, ["0", "1"], 0.01)).toThrow("No selected vertices");
    expect(() => distanceGroups(mesh, ["0", "1"], 0)).toThrow("Distance");
    expect(() => mergeByDistance(mesh, mesh.positions.map((_, i) => String(i)), 10)).toThrow();
  });
  it("applies as one editor command and rejects invalid edits without a change", () => {
    const scene = new EditorScene(new Scene(), "project"); scene.importObject("part", new Mesh(source()));
    const revision = scene.currentRevision;
    const command = { commandId: "merge", type: "geometry.merge_by_distance", objectId: "part", ids: ["0", "1", "4", "5"], distance: 0.2 };
    expect(scene.execute("edit", revision, [command]).status).toBe("applied");
    const mesh = scene.getObject("part"); if (!isMesh(mesh)) throw new Error("Missing mesh");
    expect(readTopology(mesh.geometry).positions).toHaveLength(6);
    const current = scene.currentRevision;
    expect(() => scene.execute("bad", current, [{ ...command, distance: 0 }])).toThrow();
    expect(scene.currentRevision).toBe(current);
  });
});
