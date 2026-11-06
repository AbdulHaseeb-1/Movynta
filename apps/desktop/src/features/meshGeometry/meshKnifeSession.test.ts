import { describe, expect, it } from "vitest";
import { BufferGeometry, Mesh, Scene, type Object3D } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { createPolygonMesh } from "./createPolygonMesh";
import { readTopology } from "./meshTopology";
import { KnifeSession } from "./meshKnifeSession";

function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }
describe("knife stroke preview", () => {
  it("cuts across neighboring faces and undoes each segment", () => {
    const geometry = createPolygonMesh([[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0]], [[0,1,4,3],[1,2,5,4]]);
    const source = readTopology(geometry);
    const session = new KnifeSession(source, geometry);
    session.append({ face: 0, start: { edge: "0_3", factor: 0.5 }, end: { edge: "1_4", factor: 0.5 } });
    const first = session.mesh; expect(first.faces).toHaveLength(3);
    session.append({ face: 2, start: { vertex: "7" }, end: { edge: "2_5", factor: 0.5 } });
    expect(session.length).toBe(2); expect(session.mesh.faces).toHaveLength(4);
    session.undo(); expect(session.mesh).toBe(first); expect(session.length).toBe(1);
    session.undo(); expect(session.mesh).toBe(source); expect(session.length).toBe(0);
  });
  it("commits a multi-face path atomically and rejects a bad later segment", () => {
    const source = createPolygonMesh([[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0]], [[0,1,4,3],[1,2,5,4]]);
    const scene = new EditorScene(new Scene(), "project"); scene.importObject("panel", new Mesh(source));
    const segments = [{ face: "0", start: { edge: "0_3", factor: 0.5 }, end: { edge: "1_4", factor: 0.5 } }, { face: "2", start: { vertex: "7" }, end: { edge: "2_5", factor: 0.5 } }];
    const command = { commandId: "path", type: "geometry.knife_path", objectId: "panel", segments };
    const revision = scene.currentRevision;
    const invalid = { ...command, segments: [segments[0], { face: "999", start: { vertex: "0" }, end: { vertex: "1" } }] };
    expect(scene.execute("bad", revision, [invalid]).status).toBe("failed");
    expect(scene.currentRevision).toBe(revision);
    const object = scene.getObject("panel"); if (!isMesh(object)) throw new Error("Missing mesh");
    expect(readTopology(object.geometry).faces).toHaveLength(2);
    expect(scene.execute("good", revision, [command]).status).toBe("applied");
    expect(readTopology(object.geometry).faces).toHaveLength(4);
  });
  it("rejects an over-budget stroke before changing the preview", () => {
    const source = { positions: [], faces: Array.from({ length: 160000 }, () => [0, 1, 2]) };
    const session = new KnifeSession(source, new BufferGeometry());
    expect(() => session.append({ face: 0, start: { vertex: "0" }, end: { vertex: "2" } })).toThrow("budget");
    expect(session.mesh).toBe(source); expect(session.length).toBe(0);
  });
  it("leaves the preview unchanged when a segment fails", () => {
    const geometry = createPolygonMesh([[0,0,0],[1,0,0],[1,1,0],[0,1,0]], [[0,1,2,3]]);
    const source = readTopology(geometry);
    const session = new KnifeSession(source, geometry);
    expect(() => session.append({ face: 0, start: { vertex: "0" }, end: { vertex: "1" } })).toThrow();
    expect(session.mesh).toBe(source); expect(session.length).toBe(0);
  });
});
