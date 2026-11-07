import { describe, expect, it } from "vitest";
import { Bone, BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Scene, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three";
import { EditorScene } from "./EditorScene";
import { modifierStack } from "../meshGeometry/modifierStack";
import { ensureManifold } from "../meshGeometry/meshBoolean";
import { isMesh } from "@/lib/three";

describe("hierarchy duplication", () => {
  it("rejects copying a skin without its external skeleton hierarchy", () => {
    const editor = new EditorScene(new Scene(), "p"), rig = new Group(), bone = new Bone(), skin = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
    rig.add(bone, skin); skin.bind(new Skeleton([bone])); editor.importObject("rig", rig); editor.importObject("skin", skin);
    const result = editor.execute("copy", editor.currentRevision, [{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "skin", copies: [{ objectId: "copy", descendants: [] }], offset: [2, 0, 0] }]);
    expect(result.status).toBe("failed"); expect(editor.getObject("copy")).toBeUndefined(); expect(editor.getObject("skin")).toBe(skin); editor.reset();
  });
  it("copies skeleton bones and skin buffers independently", () => {
    const editor = new EditorScene(new Scene(), "p"), geometry = new BoxGeometry(), count = geometry.getAttribute("position").count;
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4));
    const source = new SkinnedMesh(geometry, new MeshStandardMaterial()), bone = new Bone(); source.add(bone); source.bind(new Skeleton([bone])); editor.importObject("skin", source);
    const result = editor.execute("copy", editor.currentRevision, [{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "skin", copies: [{ objectId: "copy", descendants: [] }], offset: [2, 0, 0] }]);
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
    const live = editor.getObject("skin"), copy = editor.getObject("copy");
    if (!(live instanceof SkinnedMesh) || !(copy instanceof SkinnedMesh)) throw new Error("Missing skeletons");
    expect(copy.skeleton).not.toBe(live.skeleton); expect(copy.skeleton.bones[0]).not.toBe(live.skeleton.bones[0]); expect(copy.geometry).not.toBe(live.geometry); editor.reset();
  });
  it("reevaluates copied live Boolean dependencies independently after moving the copied cutter", async () => {
    await ensureManifold();
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("create", 0, [{ commandId: "root", type: "scene.create_object", objectId: "root", name: "Assembly" },
      { commandId: "target", type: "geometry.create_primitive", objectId: "target", parentId: "root", primitive: "box", size: 2 },
      { commandId: "cut", type: "geometry.create_primitive", objectId: "cut", parentId: "root", primitive: "box", size: 1, transform: { position: [0.8, 0, 0] } }]);
    expect(editor.execute("cut", editor.currentRevision, [{ commandId: "boolean", type: "geometry.boolean", objectId: "target", operandObjectId: "cut" }]).status).toBe("applied");
    expect(editor.execute("copy", editor.currentRevision, [{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "root", copies: [{ objectId: "copy", descendants: [{ sourceId: "target", objectId: "target-copy" }, { sourceId: "cut", objectId: "cut-copy" }] }], offset: [4, 0, 0] }]).status).toBe("applied");
    const fingerprint = (id: string) => { const mesh = editor.getObject(id); if (!isMesh(mesh)) throw new Error("Missing target"); return Array.from(mesh.geometry.getAttribute("position").array); };
    const original = fingerprint("target"), copied = fingerprint("target-copy");
    expect(editor.execute("move-copy", editor.currentRevision, [{ commandId: "move", type: "scene.move_object", objectId: "cut-copy", delta: [0.1, 0, 0] }]).status).toBe("applied");
    expect(fingerprint("target")).toEqual(original); expect(fingerprint("target-copy")).not.toEqual(copied); editor.reset();
  });
  it("copies registered children and imported parts with independent resources and fresh names", () => {
    const editor = new EditorScene(new Scene(), "p"), root = new Group(); root.name = "Assembly";
    const imported = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); imported.name = "Imported"; root.add(imported); editor.importObject("root", root);
    editor.execute("child", editor.currentRevision, [{ commandId: "child", type: "geometry.create_primitive", objectId: "child", primitive: "box", size: 1, parentId: "root" }]);
    expect(editor.execute("copy", editor.currentRevision, [{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "root", copies: [
      { objectId: "copy", descendants: [{ sourceId: "child", objectId: "child-copy" }] },
      { objectId: "copy2", descendants: [{ sourceId: "child", objectId: "child-copy2" }] },
    ], offset: [3, 0, 0] }]).status).toBe("applied");
    expect(editor.getObject("copy")?.name).toBe("Assembly.001"); expect(editor.getObject("copy2")?.name).toBe("Assembly.002");
    expect(editor.getObject("child-copy")?.parent).toBe(editor.getObject("copy"));
    expect(editor.getObject("copy2")?.position.x).toBe(6);
    const part = editor.getObject("copy")?.children.find((node) => node.name === "Imported");
    expect(part).toBeInstanceOf(Mesh);
    if (part instanceof Mesh) { expect(part.geometry).not.toBe(imported.geometry); expect(part.material).not.toBe(imported.material); }
    editor.reset();
  });
  it("converts world offsets through a rotated, nonuniform parent", () => {
    const editor = new EditorScene(new Scene(), "p"), parent = new Group(); parent.rotation.z = 0.5; parent.scale.set(2, 3, 1); editor.importObject("parent", parent);
    editor.execute("child", editor.currentRevision, [{ commandId: "child", type: "geometry.create_primitive", objectId: "child", parentId: "parent", primitive: "box", size: 1 }]);
    const before = editor.getObject("child")?.getWorldPosition(new Vector3());
    expect(editor.execute("copy", editor.currentRevision, [{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "child", copies: [{ objectId: "copy", descendants: [] }], offset: [1, 2, 0], space: "world" }]).status).toBe("applied");
    const after = editor.getObject("copy")?.getWorldPosition(new Vector3());
    expect(after?.clone().sub(before ?? new Vector3()).distanceTo(new Vector3(1, 2, 0))).toBeLessThan(1e-8); editor.reset();
  });
  it("rejects incomplete mappings and occupied IDs atomically", () => {
    const editor = new EditorScene(new Scene(), "p"); editor.execute("create", 0, [{ commandId: "root", type: "scene.create_object", objectId: "root", name: "Root" }, { commandId: "child", type: "scene.create_object", objectId: "child", parentId: "root", name: "Child" }]);
    const before = editor.getObject("root");
    const command = { commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "root", copies: [{ objectId: "copy", descendants: [] }], offset: [1, 0, 0] };
    expect(editor.execute("missing", editor.currentRevision, [command]).status).toBe("failed"); expect(editor.getObject("copy")).toBeUndefined(); expect(editor.getObject("root")).toBe(before);
    expect(editor.execute("occupied", editor.currentRevision, [{ ...command, copies: [{ objectId: "root", descendants: [{ sourceId: "child", objectId: "new-child" }] }] }]).status).toBe("failed"); editor.reset();
  });
  it("remaps copied Boolean cutters while retaining external references", () => {
    const editor = new EditorScene(new Scene(), "p");
    editor.execute("create", 0, [{ commandId: "root", type: "scene.create_object", objectId: "root", name: "Assembly" },
      { commandId: "target", type: "geometry.create_primitive", objectId: "target", parentId: "root", primitive: "box", size: 2 },
      { commandId: "cut", type: "geometry.create_primitive", objectId: "cut", parentId: "root", primitive: "box", size: 1, transform: { position: [0.8, 0, 0] } }]);
    // Disabled Boolean still records its operand and must remap before it is enabled on the copy.
    editor.execute("stack", editor.currentRevision, [{ commandId: "stack", type: "geometry.set_modifiers", objectId: "target", modifiers: [{ id: "cut", kind: "boolean", enabled: false, operation: "difference", operandObjectId: "cut" }] }]);
    expect(editor.execute("copy", editor.currentRevision, [{ commandId: "copy", type: "scene.duplicate_hierarchy", sourceId: "root", copies: [{ objectId: "copy", descendants: [{ sourceId: "target", objectId: "target-copy" }, { sourceId: "cut", objectId: "cut-copy" }] }], offset: [4, 0, 0] }]).status).toBe("applied");
    const target = editor.getObject("target-copy");
    if (!isMesh(target)) throw new Error("Missing target");
    expect(modifierStack(target)?.modifiers[0]).toMatchObject({ operandObjectId: "cut-copy" }); editor.reset();
  });
});
