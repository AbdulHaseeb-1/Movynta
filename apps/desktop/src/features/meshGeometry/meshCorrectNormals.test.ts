import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, Scene, Vector3 } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { assertManifold, channels, readTopology, topology } from "./meshTopology";
import { correctNormals } from "./meshCorrectNormals";
import { isMesh } from "@/lib/three";
describe("normal correction", () => {
  it("corrects winding on an open surface while preserving the first face", () => {
    const mesh = { positions: [new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(1,1,0),new Vector3(0,1,0)], faces: [[0,1,2],[0,3,2]] };
    const result = correctNormals(mesh, "outward");
    expect(result.openShells).toBe(1); expect(result.flipped).toBe(1); expect(result.mesh.faces[0]).toEqual(mesh.faces[0]);
    expect(() => assertManifold(result.mesh, topology(result.mesh))).not.toThrow();
    expect(result.mesh.channels?.corners[1]).toEqual([...channels(mesh).corners[1] ?? []].reverse());
  });
  it("orients a closed inside-out cube outward", () => {
    const cube = readTopology(new BoxGeometry()); const mesh = { ...cube, faces: cube.faces.map((face) => [...face].reverse()), channels: { ...channels(cube), corners: channels(cube).corners.map((corners) => [...corners].reverse()) } };
    const result = correctNormals(mesh, "outward");
    expect(result.openShells).toBe(0); expect(result.flipped).toBe(mesh.faces.length);
    expect(result.mesh.faces).toEqual(cube.faces);
  });
  it("refuses non-manifold edges", () => {
    const positions = [new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,-1,0),new Vector3(0,0,1)];
    expect(() => correctNormals({ positions, faces: [[0,1,2],[1,0,3],[0,1,4]] }, "consistent")).toThrow("non-manifold");
  });
  it("repairs an imported mesh in the editor", () => {
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute([0,0,0, 1,0,0, 1,1,0, 0,1,0],3)); geometry.setIndex([0,1,2,0,3,2]);
    const scene = new EditorScene(new Scene(), "project"); scene.importObject("part", new Mesh(geometry));
    expect(scene.execute("correct", scene.currentRevision, [{ commandId: "normals", type: "geometry.correct_normals", objectId: "part", mode: "consistent" }]).status).toBe("applied");
    const object = scene.getObject("part"); if (!isMesh(object)) throw new Error("Missing mesh");
    const result = readTopology(object.geometry); expect(() => assertManifold(result, topology(result))).not.toThrow();
    expect(object.geometry.getAttribute("normal")).toBeDefined();
  });
});
