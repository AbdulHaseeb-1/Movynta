import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Mesh, Scene, type Object3D } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { readTopology } from "./meshTopology";
import { removeDuplicateFaces } from "./meshDuplicateFaces";
function meshGeometry(reverse = false) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 0,0,0, 1,0,0, 0,1,0], 3));
  geometry.setIndex(reverse ? [0,1,2,3,5,4] : [0,1,2,3,4,5]);
  return geometry;
}
function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }
describe("remove duplicate faces", () => {
  it("removes matching duplicates and keeps a valid surface", () => {
    const source = meshGeometry(); const result = removeDuplicateFaces(readTopology(source), source);
    expect(result.removed).toBe(1); expect(result.mesh.faces).toHaveLength(1);
  });
  it("rejects opposite winding, different materials and different attributes", () => {
    const reversed = meshGeometry(true); expect(() => removeDuplicateFaces(readTopology(reversed), reversed)).toThrow("winding");
    const materials = meshGeometry(); materials.addGroup(0,3,0); materials.addGroup(3,3,1);
    expect(() => removeDuplicateFaces(readTopology(materials), materials)).toThrow("materials");
    const uv = meshGeometry(); uv.setAttribute("uv", new Float32BufferAttribute([0,0, 1,0, 0,1, 0.5,0, 1,0, 0,1], 2));
    expect(() => removeDuplicateFaces(readTopology(uv), uv)).toThrow("attributes");
  });
  it("applies atomically in the editor", () => {
    const scene = new EditorScene(new Scene(), "project"); scene.importObject("part", new Mesh(meshGeometry()));
    const result = scene.execute("cleanup", scene.currentRevision, [{ commandId: "clean", type: "geometry.remove_duplicate_faces", objectId: "part" }]);
    expect(result.status).toBe("applied");
    const object = scene.getObject("part"); if (!isMesh(object)) throw new Error("Missing mesh");
    expect(readTopology(object.geometry).faces).toHaveLength(1);
    const replay = new EditorScene(new Scene(), "project"); replay.importObject("part", new Mesh(meshGeometry()));
    expect(replay.execute("cleanup", replay.currentRevision, [{ commandId: "clean", type: "geometry.remove_duplicate_faces", objectId: "part" }]).status).toBe("applied");
    const replayed = replay.getObject("part"); if (!isMesh(replayed)) throw new Error("Missing replayed mesh");
    expect(readTopology(replayed.geometry).faces).toEqual(readTopology(object.geometry).faces);
  });
});
