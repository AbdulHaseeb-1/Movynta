import { describe, expect, it } from "vitest";
import { Mesh, MeshStandardMaterial, Scene, type Material, type Object3D } from "three";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import { checkManifold } from "../meshGeometry/meshManifold";
import { measureSurface } from "../meshGeometry/meshTestSupport";
import { readTopology } from "../meshGeometry/meshTopology";
import { EditorScene } from "./EditorScene";

function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }
function meshNamed(editor: EditorScene, id: string): Mesh {
  const object = editor.getObject(id);
  if (!isMesh(object)) throw new Error(`Missing mesh ${id}`);
  return object;
}
const separate = (extra: Record<string, unknown>) => ({ commandId: "split", type: "geometry.separate_faces", objectId: "body", ...extra });
function sceneWith(primitive: string, extra: Record<string, unknown> = {}) {
  const editor = new EditorScene(new Scene(), "project");
  expect(editor.execute("make", 0, [{ commandId: "body", type: "geometry.create_primitive", objectId: "body", primitive, size: 1, ...extra }]).status).toBe("applied");
  return editor;
}
const materialsOf = (mesh: Mesh): Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

describe("separate faces", () => {
  it("moves a patch of a sphere into its own object without losing any surface", () => {
    const editor = sceneWith("sphere"), whole = measureSurface(readTopology(meshNamed(editor, "body").geometry));
    const faces = readTopology(meshNamed(editor, "body").geometry).faces;
    // The first rows of a sphere are one connected cap.
    const cap = Array.from({ length: 48 }, (_, face) => String(face)).filter((id) => faces[Number(id)] !== undefined);
    const result = editor.execute("split", editor.currentRevision, [separate({ ids: cap, newObjectId: "cap", name: "Cap" })]);
    expect(result.status).toBe("applied");
    expect(result.status === "applied" && result.results[0] && "name" in result.results[0] ? result.results[0].name : undefined).toBe("Cap");
    const body = readTopology(meshNamed(editor, "body").geometry), part = readTopology(meshNamed(editor, "cap").geometry);
    expect(body.faces).toHaveLength(faces.length - cap.length);
    expect(part.faces).toHaveLength(cap.length);
    expect(measureSurface(body).area + measureSurface(part).area).toBeCloseTo(whole.area, 5);
    expect(() => checkManifold(body)).not.toThrow();
    expect(() => checkManifold(part)).not.toThrow();
    expect(editor.context().objects.map((object) => object.id).sort()).toEqual(["body", "cap"]);
    expect(editor.context().objects.find((object) => object.id === "cap")?.name).toBe("Cap");
  });

  it("makes the new object a sibling in the same collection, in the same place, with its own materials", () => {
    const editor = new EditorScene(new Scene(), "project");
    expect(editor.execute("make", 0, [
      { commandId: "set", type: "scene.create_collection", collectionId: "props", name: "Props" },
      { commandId: "group", type: "scene.create_object", objectId: "group", name: "Group", collectionId: "props", transform: { position: [1, 2, 3] } },
      { commandId: "body", type: "geometry.create_primitive", objectId: "body", primitive: "box", size: 1, parentId: "group", transform: { position: [0, 1, 0], rotation: [0, 0.5, 0], scale: [1, 2, 1] } },
    ]).status).toBe("applied");
    const before = meshNamed(editor, "body");
    before.material = [new MeshStandardMaterial({ color: "#336699" }), new MeshStandardMaterial({ color: "#aa3300" })];
    expect(editor.execute("split", editor.currentRevision, [separate({ ids: ["0"], newObjectId: "lid" })]).status).toBe("applied");
    const body = meshNamed(editor, "body"), lid = meshNamed(editor, "lid");
    expect(lid.parent).toBe(body.parent);
    expect(lid.position.toArray()).toEqual(body.position.toArray());
    expect(lid.quaternion.toArray()).toEqual(body.quaternion.toArray());
    expect(lid.scale.toArray()).toEqual(body.scale.toArray());
    expect(materialsOf(lid)).toHaveLength(materialsOf(body).length);
    materialsOf(lid).forEach((material, slot) => {
      expect(material).not.toBe(materialsOf(body)[slot]);
      expect(material).toBeInstanceOf(MeshStandardMaterial);
    });
    const context = editor.context();
    expect(context.objects.find((object) => object.id === "lid")?.parentId).toBe("group");
    expect(context.objects.find((object) => object.id === "lid")?.collectionId).toBe("props");
    expect(lid.name).toBe("box part");
  });

  it("gives each part a distinct name among its siblings", () => {
    const editor = sceneWith("box");
    editor.execute("one", editor.currentRevision, [separate({ ids: ["0"], newObjectId: "a", name: "Part" })]);
    editor.execute("two", editor.currentRevision, [separate({ ids: ["0"], newObjectId: "b", name: "Part" })]);
    expect(new Set(editor.context().objects.map((object) => object.name)).size).toBe(3);
  });

  it("replays to the same two meshes", () => {
    const run = () => { const editor = sceneWith("sphere"); editor.execute("split", editor.currentRevision, [separate({ ids: ["0", "1", "2"], newObjectId: "cap" })]); return editor; };
    const first = run(), second = run();
    for (const id of ["body", "cap"]) {
      expect(readTopology(meshNamed(first, id).geometry).faces).toEqual(readTopology(meshNamed(second, id).geometry).faces);
    }
  });

  it("refuses unsafe requests and changes nothing", () => {
    const editor = sceneWith("box");
    expect(editor.execute("other", editor.currentRevision, [{ commandId: "other", type: "scene.create_object", objectId: "other", name: "Other" }]).status).toBe("applied");
    expect(editorCommandListSchema.safeParse([separate({ ids: ["0"], newObjectId: "body" })]).success).toBe(false);
    const body = meshNamed(editor, "body"), geometry = body.geometry, revision = editor.currentRevision;
    const every = ["0", "1", "2", "3", "4", "5"];
    expect(editor.execute("stale", revision - 1, [separate({ ids: ["0"], newObjectId: "x" })]).status).toBe("revision_conflict");
    for (const [name, fields, message] of [
      ["every face", { ids: every, newObjectId: "x" }, "nothing would stay behind"],
      ["a missing face", { ids: ["9"], newObjectId: "x" }, "does not exist"],
      ["an existing id", { ids: ["0"], newObjectId: "other" }, "fresh"],
    ] as const) {
      const result = editor.execute(name, editor.currentRevision, [separate(fields)]);
      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.message : "").toContain(message);
    }
    const second = editor.execute("pair", editor.currentRevision, [separate({ ids: ["0"], newObjectId: "x" }), separate({ commandId: "again", ids: ["1"], newObjectId: "y" })]);
    expect(second.status).toBe("failed");
    expect(body.geometry).toBe(geometry);
    expect(editor.context().objects).toHaveLength(2);
    expect(editor.currentRevision).toBe(revision);
  });

  it("refuses faces that would leave a corner shared by two pieces", () => {
    const editor = sceneWith("sphere");
    const faces = readTopology(meshNamed(editor, "body").geometry).faces;
    const touching = faces.flatMap((face, a) => faces.flatMap((other, b) => (b > a && face.filter((vertex) => other.includes(vertex)).length === 1 ? [[a, b]] : [])))[0];
    expect(touching).toBeDefined();
    const result = editor.execute("pinch", editor.currentRevision, [separate({ ids: (touching ?? []).map(String), newObjectId: "x" })]);
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.message : "").toContain("cannot be separated");
    expect(editor.context().objects).toHaveLength(1);
  });

  it("refuses a mesh that still has modifiers", () => {
    const editor = sceneWith("box");
    expect(editor.execute("mods", editor.currentRevision, [{ commandId: "m", type: "geometry.set_modifiers", objectId: "body", modifiers: [{ id: "s", kind: "subdivision", enabled: true, levels: 1 }] }]).status).toBe("applied");
    const withModifiers = editor.execute("late", editor.currentRevision, [separate({ ids: ["0"], newObjectId: "x" })]);
    expect(withModifiers.status).toBe("failed");
    expect(withModifiers.status === "failed" ? withModifiers.message : "").toMatch(/modifier/i);
  });
});
