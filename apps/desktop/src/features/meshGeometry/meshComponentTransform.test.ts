import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Matrix4, Mesh, PlaneGeometry, Scene, Vector3 } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { transformComponents } from "./meshComponentTransform";
import { cageKey, faceNormal, readTopology, point, topology } from "./meshTopology";
import { writeExtrudedGeometry } from "./meshExtrude";
import { commitStack, evaluateStack, modifierStack } from "./modifierStack";

describe("base component transforms", () => {
  it("moves a welded vertex and preserves untouched positions and face IDs", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cage = readTopology(source);
    const result = transformComponents(cage, "vertex", ["0"], { position: [0.2, 0.3, 0.4] });
    expect(point(result.mesh, 0).distanceTo(point(cage, 0).clone().add(new Vector3(0.2, 0.3, 0.4)))).toBeLessThan(1e-10);
    expect(result.mesh.faces).toBe(cage.faces);
    cage.positions.slice(1).forEach((position, i) => expect(point(result.mesh, i + 1).equals(position)).toBe(true));
    expect(result.mesh.channels).toBe(cage.channels);
    source.dispose();
  });
  it("moves shared endpoints once across adjacent selected edges", () => {
    const source = new BoxGeometry();
    const cage = readTopology(source);
    const adjacent = topology(cage).vertexEdges[0]?.slice(0, 2) ?? [];
    expect(adjacent).toHaveLength(2);
    const result = transformComponents(cage, "edge", adjacent, { position: [0, 0.2, 0] });
    expect(point(result.mesh, 0).y).toBeCloseTo(point(cage, 0).y + 0.2);
    source.dispose();
  });
  it("scales and rotates around an explicit pivot in the chosen coordinate space", () => {
    const source = new PlaneGeometry(2, 2);
    const cage = readTopology(source);
    const world = new Matrix4().makeRotationY(0.4).scale(new Vector3(2, 3, 4)).setPosition(8, 5, 2);
    const pivot = new Vector3(1, 2, 3);
    const result = transformComponents(cage, "vertex", ["0"], { scale: [1.2, 1, 1], rotation: [0, 0, 0.2], position: [0, 0.1, 0] }, world, pivot.toArray());
    const expected = point(cage, 0).clone().applyMatrix4(world).sub(pivot).multiply(new Vector3(1.2, 1, 1))
      .applyAxisAngle(new Vector3(0, 0, 1), 0.2).add(pivot).add(new Vector3(0, 0.1, 0));
    expect(point(result.mesh, 0).clone().applyMatrix4(world).distanceTo(expected)).toBeLessThan(1e-10);
    source.dispose();
  });
  it("preserves UV seams and material assignments through geometry output", () => {
    const source = new BoxGeometry();
    const cage = readTopology(source);
    const result = transformComponents(cage, "vertex", ["0"], { position: [0.1, 0.1, 0.1] });
    const output = writeExtrudedGeometry(source, result);
    const after = readTopology(output);
    expect(after.faces).toEqual(cage.faces);
    expect(after.channels?.materials).toEqual(cage.channels?.materials);
    expect(output.getAttribute("uv").count).toBeGreaterThan(after.positions.length);
    const uvs = (geometry: typeof source | typeof output) => {
      const uv = geometry.getAttribute("uv");
      return Array.from({ length: uv.count }, (_, i) => `${uv.getX(i)},${uv.getY(i)}`).sort();
    };
    expect(new Set(uvs(output))).toEqual(new Set(uvs(source)));
    output.dispose(); source.dispose();
  });
  it("rejects nonexistent, reversed or duplicate IDs and singular transforms", () => {
    const source = new BoxGeometry(); const cage = readTopology(source);
    for (const [kind, ids] of [["vertex", ["999"]], ["vertex", ["0", "0"]], ["edge", ["1_0"]], ["edge", ["0_999"]]] as const) {
      expect(() => transformComponents(cage, kind, ids, { position: [1, 0, 0] })).toThrow();
    }
    expect(() => transformComponents(cage, "vertex", ["0"], { position: [1, 0, 0] }, new Matrix4().makeScale(0, 1, 1))).toThrow("singular");
    source.dispose();
  });
});

describe("component transform command", () => {
  it("refuses a transform that collapses an adjoining triangle", () => {
    const mesh = { positions: [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0)], faces: [[0, 1, 2]] };
    expect(() => transformComponents(mesh, "vertex", ["0"], { position: [1, 0, 0] })).toThrow("collapses");
    expect(mesh.positions[0]?.x).toBe(0);
  });
  function setup() {
    const editor = new EditorScene(new Scene(), "project");
    const mesh = new Mesh(new BoxGeometry()); editor.importObject("box", mesh);
    const command = { commandId: "move", type: "geometry.transform_components", objectId: "box", kind: "vertex", ids: ["0"], transform: { position: [0.1, 0, 0] } };
    return { editor, mesh, command };
  }
  it("applies once, rejects stale revisions, and replays identically", () => {
    const { editor, mesh, command } = setup();
    const before = point(readTopology(mesh.geometry), 0).clone();
    const revision = editor.currentRevision;
    expect(editor.execute("stale", revision - 1, [command]).status).toBe("revision_conflict");
    expect(editor.execute("move", revision, [command]).status).toBe("applied");
    expect(point(readTopology(mesh.geometry), 0).x).toBeCloseTo(before.x + 0.1);
    editor.execute("move", revision, [command]);
    expect(point(readTopology(mesh.geometry), 0).x).toBeCloseTo(before.x + 0.1);
    const replay = setup();
    replay.editor.execute("replay", replay.editor.currentRevision, [command]);
    expect(readTopology(replay.mesh.geometry).positions).toEqual(readTopology(mesh.geometry).positions);
    replay.editor.reset(); editor.reset();
  });
  it("rolls back the whole batch if a later component is invalid", () => {
    const { editor, mesh, command } = setup(); const original = mesh.geometry;
    expect(editor.execute("bad", editor.currentRevision, [command, { ...command, commandId: "bad", ids: ["999"] }]).status).toBe("failed");
    expect(mesh.geometry).toBe(original); editor.reset();
  });
  it("reevaluates enabled modifiers using the verified base cage", () => {
    const { editor, mesh, command } = setup();
    commitStack(mesh, evaluateStack(mesh, [{ id: "sub", kind: "subdivision", enabled: true, levels: 1 }]));
    const before = modifierStack(mesh)?.base;
    expect(editor.execute("base", editor.currentRevision, [command]).status).toBe("applied");
    expect(modifierStack(mesh)?.base).not.toBe(before);
    expect(modifierStack(mesh)?.modifiers[0]?.id).toBe("sub"); editor.reset();
  });
  it("converts world movement through a rotated and nonuniformly scaled imported parent", () => {
    const editor = new EditorScene(new Scene(), "p"); const parent = new Group();
    parent.rotation.z = 0.5; parent.scale.set(2, 3, 1);
    const mesh = new Mesh(new BoxGeometry()); parent.add(mesh); editor.importObject("model", parent);
    parent.updateWorldMatrix(true, true);
    const before = point(readTopology(mesh.geometry), 0).clone().applyMatrix4(mesh.matrixWorld);
    expect(editor.execute("move", editor.currentRevision, [{ commandId: "v", type: "geometry.transform_components", objectId: "model", meshPath: [0],
      kind: "vertex", ids: ["0"], space: "world", transform: { position: [0.1, 0, 0] } }]).status).toBe("applied");
    const after = point(readTopology(mesh.geometry), 0).clone().applyMatrix4(mesh.matrixWorld);
    expect(after.distanceTo(before.add(new Vector3(0.1, 0, 0)))).toBeLessThan(1e-6); editor.reset();
  });
  it("protects live extrusion anchors while permitting edits away from them", () => {
    const { editor, mesh, command } = setup(); const cage = readTopology(mesh.geometry);
    const top = cage.faces.findIndex((face) => faceNormal(cage, face).y > 0.9);
    const anchors = cage.faces[top] ?? [];
    const protectedVertex = anchors[0];
    const freeVertex = cage.positions.findIndex((_, i) => !anchors.includes(i));
    if (protectedVertex === undefined || freeVertex < 0) throw new Error("Missing test vertices");
    commitStack(mesh, evaluateStack(mesh, [{ id: "extrude", kind: "extrusion", enabled: true, ids: [String(top)], baseKey: cageKey(cage), normalDistance: 0.2 }]));
    const before = mesh.geometry;
    expect(editor.execute("protected", editor.currentRevision, [{ ...command, ids: [String(protectedVertex)] }]).status).toBe("failed");
    expect(mesh.geometry).toBe(before);
    expect(editor.execute("free", editor.currentRevision, [{ ...command, ids: [String(freeVertex)] }]).status).toBe("applied");
    expect(modifierStack(mesh)?.modifiers[0]).toMatchObject({ id: "extrude", enabled: true }); editor.reset();
  });
});
