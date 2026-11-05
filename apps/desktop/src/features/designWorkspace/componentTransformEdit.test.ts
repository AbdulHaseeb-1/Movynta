import { describe, expect, it } from "vitest";
import { BoxGeometry, Scene, Vector3 } from "three";
import { editorCommandSchema, HAND_EDIT_COMMAND_TYPES } from "@movynta/editor-protocol";
import { EditorScene } from "../assistant/EditorScene";
import { meshAtPath } from "../meshGeometry";
import { componentTransformSelection } from "../meshGeometry/meshComponentTransform";
import { transformFaces } from "../meshGeometry/meshFaceTransform";
import { point, readTopology } from "../meshGeometry/meshTopology";

/** The manual vertex/edge move: what the gesture previews, and the command it saves. */
describe("moving vertices and edges by hand", () => {
  it("previews with the same math as a face move, and keeps the chosen components selected", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cage = readTopology(source);
    const selected = componentTransformSelection(cage, "vertex", ["0", "3"]);
    const result = transformFaces(cage, ["0", "3"], { position: [0.5, 0, 0] }, undefined, selected);
    expect(result.selection).toEqual(["0", "3"]);
    for (const id of [0, 3]) expect(point(result.mesh, id).distanceTo(point(cage, id).clone().add(new Vector3(0.5, 0, 0)))).toBeLessThan(1e-10);
    for (const id of [1, 2, 4]) expect(point(result.mesh, id).equals(point(cage, id))).toBe(true);
    source.dispose();
  });

  it("scales an edge selection about its own middle", () => {
    const source = new BoxGeometry(2, 2, 2);
    const cage = readTopology(source);
    const edge = [...new Set(cage.faces.flatMap((face) => face.map((from, i) => {
      const to = face[(i + 1) % face.length] ?? from;
      return from < to ? `${from}_${to}` : `${to}_${from}`;
    })))][0] ?? "";
    const [a = 0, b = 0] = edge.split("_").map(Number);
    const selected = componentTransformSelection(cage, "edge", [edge]);
    const result = transformFaces(cage, [edge], { scale: [2, 2, 2] }, undefined, selected);
    const before = point(cage, a).distanceTo(point(cage, b));
    expect(point(result.mesh, a).distanceTo(point(result.mesh, b))).toBeCloseTo(before * 2, 9);
    expect(point(result.mesh, a).clone().add(point(result.mesh, b)).multiplyScalar(0.5).distanceTo(point(cage, a).clone().add(point(cage, b)).multiplyScalar(0.5))).toBeLessThan(1e-9);
    source.dispose();
  });

  it("is saved as a command the backend accepts from a person and the editor applies in world space", () => {
    expect(HAND_EDIT_COMMAND_TYPES.has("geometry.transform_components")).toBe(true);
    const editor = new EditorScene(new Scene(), "project");
    editor.execute("make", 0, [{ commandId: "c", type: "geometry.create_primitive", objectId: "block", primitive: "box", size: 2,
      transform: { position: [1, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [2, 1, 1] } }]);
    // The editor may swap in a new object, and vertex numbers may change when it writes the mesh back, so compare positions.
    const corners = () => {
      const mesh = meshAtPath(editor.getObject("block"), []);
      mesh.updateWorldMatrix(true, false);
      return readTopology(mesh.geometry).positions.map((position) => position.clone().applyMatrix4(mesh.matrixWorld));
    };
    const has = (list: Vector3[], target: Vector3) => list.some((position) => position.distanceTo(target) < 1e-6);
    const before = corners();
    const moved = before[0] ?? new Vector3();
    const delta = new Vector3(0, 0.75, 0);
    const command = { commandId: "move", type: "geometry.transform_components", objectId: "block", kind: "vertex", ids: ["0"], space: "world", transform: { position: delta.toArray() } };
    expect(editorCommandSchema.safeParse(command).success).toBe(true);
    expect(editor.execute("move", editor.currentRevision, [command]).status).toBe("applied");
    const after = corners();
    // A move along world Y stays one even though the object is turned and stretched; every other corner stays put.
    expect(has(after, moved.clone().add(delta))).toBe(true);
    expect(has(after, moved)).toBe(false);
    for (const corner of before.slice(1)) expect(has(after, corner)).toBe(true);
  });
});
