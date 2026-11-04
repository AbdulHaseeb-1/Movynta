import { describe, expect, it } from "vitest";
import { editorCommandSchema } from "@movynta/editor-protocol";
import { assertManifold, readTopology, topology } from "./meshTopology";
import { createPrimitive } from "./createPrimitive";
import { createPolygonMesh } from "./createPolygonMesh";
import { EditorScene } from "../assistant/EditorScene";
import { Mesh, Scene, type Object3D } from "three";

function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}

describe("parameterized primitives", () => {
  it("builds requested box dimensions into geometry", () => {
    const parsed = editorCommandSchema.parse({ commandId: "p", type: "geometry.create_primitive", objectId: "shape", primitive: "box", size: 1, options: { width: 2, height: 3, depth: 4 } });
    if (parsed.type !== "geometry.create_primitive") throw new Error("Expected a primitive");
    const geometry = createPrimitive(parsed);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.max.toArray()).toEqual([1, 1.5, 2]);
    geometry.dispose();
  });
  it.each(["tetrahedron", "octahedron", "icosahedron"])("builds a closed %s", (primitive) => {
    const parsed = editorCommandSchema.parse({ commandId: "p", type: "geometry.create_primitive", objectId: "shape", primitive, size: 2 });
    if (parsed.type !== "geometry.create_primitive") throw new Error("Expected a primitive");
    const geometry = createPrimitive(parsed);
    const mesh = readTopology(geometry);
    expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
    geometry.dispose();
  });
});

it("creates, commits and replays a custom polygon mesh", async () => {
  const vertices = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const commands = [{ commandId: "mesh", type: "geometry.create_mesh", objectId: "custom", name: "Custom", vertices, faces }];
  const editor = new EditorScene(new Scene(), "project");
  expect(editor.executePrepared("p", 0, commands, "prepare").status).toBe("applied");
  expect(editor.getObject("custom")).toBeUndefined();
  expect(editor.executePrepared("p", 0, commands, "commit").status).toBe("applied");
  const object = editor.getObject("custom");
  expect(object).toBeInstanceOf(Mesh);
  if (!isMesh(object)) throw new Error("Missing custom mesh");
  const cage = readTopology(object.geometry);
  expect(cage.faces).toHaveLength(6);
  expect(() => assertManifold(cage, topology(cage), true)).not.toThrow();
  const restored = new EditorScene(new Scene(), "project");
  await restored.restore([{ kind: "commands", proposalId: "p", commands }], () => Promise.reject(new Error("Unexpected import")));
  const replayed = restored.getObject("custom");
  expect(replayed).toBeInstanceOf(Mesh);
  if (isMesh(replayed)) expect(readTopology(replayed.geometry).faces).toEqual(cage.faces);
  editor.reset();
  restored.reset();
});

it("rejects inconsistent winding and zero-area polygons", () => {
  expect(() => createPolygonMesh([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [[0, 1, 2]])).toThrow(/zero area/);
  expect(() => createPolygonMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1, 2], [0, 1, 3]])).toThrow(/winding/);
  expect(() => createPolygonMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0]], [[0, 1, 2], [1, 0, 3]])).toThrow(/overlap/);
});
