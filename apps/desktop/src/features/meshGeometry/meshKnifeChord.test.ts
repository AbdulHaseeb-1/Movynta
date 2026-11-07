import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, Scene, Vector3 } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { basis, evaluate } from "./meshWeights";
import { createPolygonMesh } from "./createPolygonMesh";
import { assertManifold, edgeKey, readTopology, topology } from "./meshTopology";
import { knifeChord } from "./meshKnifeChord";
import { isMesh } from "@/lib/three";

describe("knife chord topology", () => {
  it("splits a face and its neighboring boundary without cracks", () => {
    const geometry = createPolygonMesh([[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0]], [[0,1,4,3],[1,2,5,4]]);
    const source = readTopology(geometry);
    const result = knifeChord(source, 0, { edge: "0_3", factor: 0.5 }, { edge: "1_4", factor: 0.5 }, geometry);
    expect(result.mesh.positions).toHaveLength(8); expect(result.mesh.faces).toHaveLength(3);
    expect(result.mesh.faces[2]).toHaveLength(5);
    expect(() => assertManifold(result.mesh, topology(result.mesh))).not.toThrow();
    expect(result.selection).toEqual(["6_7"]);
    expect(result.mesh.channels?.corners.every((corners, i) => corners.length === result.mesh.faces[i]?.length)).toBe(true);
  });
  it("keeps a closed box closed when the cut crosses its boundary edges", () => {
    const geometry = new BoxGeometry(), source = readTopology(geometry), face = source.faces[0];
    if (!face || face.length !== 4) throw new Error("Missing box face");
    const a = face[0], b = face[1], c = face[2], d = face[3];
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error("Missing box corners");
    const result = knifeChord(source, 0, { edge: edgeKey(a,b), factor: 0.5 }, { edge: edgeKey(c,d), factor: 0.5 }, geometry);
    expect(() => assertManifold(result.mesh, topology(result.mesh), true)).not.toThrow();
  });
  it("interpolates each side of a UV seam independently", () => {
    const positions = [[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0]].map((p) => new Vector3().fromArray(p));
    const faces = [[0,1,4,3],[1,2,5,4]];
    const mesh = { positions, faces, channels: { positions: positions.map((_, i) => basis(i)), corners: [[0,1,2,3].map(basis), [4,5,6,7].map(basis)], materials: [0,1] } };
    const uv = new Float32BufferAttribute([0,0, 1,0, 1,1, 0,1, 10,0, 11,0, 11,1, 10,1], 2);
    const geometry = new BufferGeometry().setAttribute("uv", uv);
    const result = knifeChord(mesh, 0, { edge: "0_3", factor: 0.5 }, { edge: "1_4", factor: 0.5 }, geometry);
    const samples = result.mesh.faces.flatMap((face, i) => face.flatMap((id, corner) => { const sample = result.mesh.channels?.corners[i]?.[corner]; return id === 7 && sample ? [evaluate(uv, sample, 0)] : []; }));
    expect(samples.sort((a, b) => a - b)).toEqual([1,1,10]);
    expect(result.mesh.channels?.materials).toEqual([0,0,1]);
  });
  it("applies a command and deterministically replays it on the same source", () => {
    const makeScene = () => { const scene = new EditorScene(new Scene(), "project"); scene.importObject("panel", new Mesh(createPolygonMesh([[0,0,0],[1,0,0],[1,1,0],[0,1,0]], [[0,1,2,3]]))); return scene; };
    const command = { commandId: "cut", type: "geometry.knife_chord", objectId: "panel", face: "0", start: { edge: "0_1", factor: 0.5 }, end: { edge: "2_3", factor: 0.5 } };
    const first = makeScene(), replay = makeScene();
    expect(first.execute("cut", first.currentRevision, [command]).status).toBe("applied");
    expect(replay.execute("cut", replay.currentRevision, [command]).status).toBe("applied");
    const a = first.getObject("panel"), b = replay.getObject("panel"); if (!isMesh(a) || !isMesh(b)) throw new Error("Missing mesh");
    expect(readTopology(a.geometry).faces).toEqual(readTopology(b.geometry).faces);
    expect(readTopology(a.geometry).faces).toHaveLength(2);
  });
  it("cuts from a vertex to an edge and between nonadjacent vertices", () => {
    const geometry = createPolygonMesh([[0,0,0],[1,0,0],[1,1,0],[0,1,0]], [[0,1,2,3]]), source = readTopology(geometry);
    const edgeCut = knifeChord(source, 0, { vertex: "0" }, { edge: "2_3", factor: 0.5 }, geometry);
    expect(edgeCut.mesh.faces).toHaveLength(2); expect(edgeCut.mesh.positions).toHaveLength(5);
    const diagonal = knifeChord(source, 0, { vertex: "0" }, { vertex: "2" }, geometry);
    expect(diagonal.mesh.faces).toEqual([[0,1,2], [2,3,0]]);
    expect(() => knifeChord(source, 0, { vertex: "0" }, { vertex: "1" }, geometry)).toThrow("boundary edge");
    expect(() => knifeChord(source, 0, { vertex: "0" }, { edge: "0_1", factor: 0.5 }, geometry)).toThrow("boundary edge");
  });
  it("rejects stale revisions, batches and enabled modifiers without changing the mesh", () => {
    const scene = new EditorScene(new Scene(), "project"), mesh = new Mesh(createPolygonMesh([[0,0,0],[1,0,0],[1,1,0],[0,1,0]], [[0,1,2,3]]));
    scene.importObject("panel", mesh);
    const command = { commandId: "cut", type: "geometry.knife_chord", objectId: "panel", face: "0", start: { edge: "0_1", factor: 0.5 }, end: { edge: "2_3", factor: 0.5 } };
    expect(scene.execute("stale", scene.currentRevision - 1, [command]).status).toBe("revision_conflict");
    const original = mesh.geometry;
    expect(scene.execute("batch", scene.currentRevision, [command, { ...command, commandId: "cut2" }]).status).toBe("failed");
    expect(mesh.geometry).toBe(original);
    expect(scene.execute("subdivide", scene.currentRevision, [{ commandId: "sub", type: "geometry.set_modifiers", objectId: "panel", modifiers: [{ id: "smooth", kind: "subdivision", enabled: true, levels: 1 }] }]).status).toBe("applied");
    const modified = mesh.geometry; expect(scene.execute("cut", scene.currentRevision, [command]).status).toBe("failed");
    expect(mesh.geometry).toBe(modified);
  });
  it("rejects cuts crossing a concave boundary and nonplanar faces", () => {
    const concave = { positions: [[0,0,0],[2,0,0],[1,0.5,0],[2,2,0],[0,2,0]].map((p) => new Vector3().fromArray(p)), faces: [[0,1,2,3,4]] };
    expect(() => knifeChord(concave, 0, { edge: "0_1", factor: 0.5 }, { edge: "3_4", factor: 0.5 }, new BufferGeometry())).toThrow("boundary");
    const nonplanar = { positions: [[0,0,0],[1,0,0],[1,1,0.3],[0,1,0]].map((p) => new Vector3().fromArray(p)), faces: [[0,1,2,3]] };
    expect(() => knifeChord(nonplanar, 0, { edge: "0_1", factor: 0.5 }, { edge: "2_3", factor: 0.5 }, new BufferGeometry())).toThrow("planar");
  });
  it("cuts inside a concave face without changing its outline", () => {
    const positions=[[0,0,0],[2,0,0],[2,1,0],[1,1,0],[1,2,0],[0,2,0]].map((p)=>new Vector3().fromArray(p));
    const result=knifeChord({positions,faces:[[0,1,2,3,4,5]]},0,{edge:"0_5",factor:0.25},{edge:"2_3",factor:0.5},new BufferGeometry());
    expect(result.mesh.faces).toHaveLength(2);expect(()=>assertManifold(result.mesh,topology(result.mesh))).not.toThrow();
  });
  it("rejects non-affine UVs and nonplanar neighboring faces", () => {
    const positions = [[0,0,0],[1,0,0],[1,1,0],[0,1,0]].map((p) => new Vector3().fromArray(p));
    const mesh = { positions, faces: [[0,1,2,3]] };
    const geometry = new BufferGeometry().setAttribute("uv", new Float32BufferAttribute([0,0,1,0,1,1,0.4,1], 2));
    expect(() => knifeChord(mesh, 0, { edge: "0_1", factor: 0.5 }, { edge: "2_3", factor: 0.5 }, geometry)).toThrow("non-affine");
    const neighbor = { positions: [[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0.3]].map((p) => new Vector3().fromArray(p)), faces: [[0,1,4,3],[1,2,5,4]] };
    expect(() => knifeChord(neighbor, 0, { edge: "0_3", factor: 0.5 }, { edge: "1_4", factor: 0.5 }, new BufferGeometry())).toThrow("planar");
  });
  it("rejects invalid endpoints without changing the source", () => {
    const geometry = createPolygonMesh([[0,0,0],[1,0,0],[1,1,0],[0,1,0]], [[0,1,2,3]]); const source = readTopology(geometry);
    expect(() => knifeChord(source, 0, { edge: "0_1", factor: 0 }, { edge: "2_3", factor: 0.5 }, geometry)).toThrow();
    expect(() => knifeChord(source, 0, { edge: "0_1", factor: 0.5 }, { edge: "0_1", factor: 0.7 }, geometry)).toThrow();
    expect(source.positions).toHaveLength(4); expect(source.faces).toHaveLength(1);
  });
});
