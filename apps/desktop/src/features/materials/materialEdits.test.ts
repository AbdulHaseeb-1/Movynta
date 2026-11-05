import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Scene, SphereGeometry, Texture, type Object3D } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { readTopology } from "../meshGeometry/meshTopology";
import { modifierStack } from "../meshGeometry/modifierStack";

function isMesh(object: Object3D | undefined): object is Mesh { return object instanceof Mesh; }
function setup(material = new MeshStandardMaterial({ color: "#123456", roughness: 0.7 })) {
  const editor = new EditorScene(new Scene(), "p"); editor.importObject("box", new Mesh(new BoxGeometry(), material));
  const mesh = (): Mesh => { const object = editor.getObject("box"); if (!isMesh(object)) throw new Error("Missing mesh"); return object; };
  const slot = (index = 0) => {
    const materials = mesh().material, value = Array.isArray(materials) ? materials[index] : materials;
    if (!(value instanceof MeshStandardMaterial)) throw new Error("Missing standard material"); return value;
  };
  return { editor, mesh, slot };
}

describe("assistant material controls", () => {
  it("inspects dense material slots without attempting bounded topology reconstruction", () => {
    const editor = new EditorScene(new Scene(), "p"); editor.importObject("dense", new Mesh(new SphereGeometry(1, 128, 128), new MeshStandardMaterial()));
    const inspection = editor.context({ objectId: "dense", meshPath: [], offset: 0, limit: 25, materialsOnly: true }).meshInspection;
    expect(inspection).toMatchObject({ status: "ok", materialSlotCount: 1, materials: [{ editable: true }] });
    expect(inspection?.stats).toBeUndefined(); editor.reset();
  });
  it("edits standard properties with sRGB colors and exposes material inspection", () => {
    const { editor, slot } = setup();
    expect(editor.execute("paint", editor.currentRevision, [{ commandId: "paint", type: "material.set_properties", objectId: "box", slot: 0,
      properties: { name: "Copper", color: "#d98855", roughness: 0.25, metalness: 0.9, emissive: "#110000", emissiveIntensity: 0.2, opacity: 0.5, depthWrite: false, side: "double" } }]).status).toBe("applied");
    expect(slot().color.getHexString()).toBe("d98855");
    expect(slot().transparent).toBe(true); expect(slot().depthWrite).toBe(false);
    const inspection = editor.context({ objectId: "box", meshPath: [], offset: 0, limit: 10, materialsOnly: true }).meshInspection;
    expect(inspection).toMatchObject({ status: "ok", materialSlotCount: 1, materials: [{ slot: 0, name: "Copper", editable: true, color: "#d98855", roughness: 0.25, metalness: 0.9, opacity: 0.5, side: "double" }] });
    expect(inspection?.stats).toBeUndefined();
    editor.reset();
  });
  it("preserves imported textures and physical properties without editing shared materials", () => {
    const editor = new EditorScene(new Scene(), "p"), texture = new Texture();
    const material = new MeshPhysicalMaterial({ color: "#123456", map: texture, clearcoat: 0.8, transmission: 0.4 });
    const group = new Group(); group.add(new Mesh(new BoxGeometry(), material), new Mesh(new BoxGeometry(), material)); editor.importObject("model", group);
    expect(editor.execute("paint", editor.currentRevision, [{ commandId: "paint", type: "material.set_properties", objectId: "model", meshPath: [0], slot: 0, properties: { roughness: 0.2 } }]).status).toBe("applied");
    const target = editor.getObject("model")?.children[0], other = editor.getObject("model")?.children[1];
    if (!(target instanceof Mesh) || !(other instanceof Mesh) || !(target.material instanceof MeshPhysicalMaterial) || !(other.material instanceof MeshPhysicalMaterial)) throw new Error("Missing physical materials");
    expect(target.material.map).toBe(texture); expect(target.material.clearcoat).toBe(0.8); expect(target.material.transmission).toBe(0.4);
    expect(target.material.roughness).toBe(0.2); expect(other.material.roughness).toBe(1); expect(material.roughness).toBe(1);
    editor.reset(); texture.dispose();
  });
  it("adds a slot without changing box visibility, face IDs or existing appearance", () => {
    const { editor, mesh, slot } = setup(); const before = readTopology(mesh().geometry);
    expect(editor.execute("add", editor.currentRevision, [{ commandId: "red", type: "material.add_slot", objectId: "box", slot: 1, properties: { name: "Red", color: "#ff0000" } }]).status).toBe("applied");
    expect(readTopology(mesh().geometry).faces).toEqual(before.faces);
    expect(readTopology(mesh().geometry).channels?.materials.every((index) => index === 0)).toBe(true);
    expect(mesh().geometry.groups.every((group) => group.materialIndex === 0)).toBe(true);
    expect(slot(0).color.getHexString()).toBe("123456"); expect(slot(1).color.getHexString()).toBe("ff0000");
    expect(editor.execute("assign", editor.currentRevision, [{ commandId: "face", type: "material.assign", objectId: "box", slot: 1, ids: ["0"] }]).status).toBe("applied");
    const assignments = readTopology(mesh().geometry).channels?.materials;
    expect(assignments?.[0]).toBe(1); expect(assignments?.slice(1).every((index) => index === 0)).toBe(true);
    expect(editor.execute("all", editor.currentRevision, [{ commandId: "all", type: "material.assign", objectId: "box", slot: 1 }]).status).toBe("applied");
    expect(readTopology(mesh().geometry).channels?.materials.every((index) => index === 1)).toBe(true); editor.reset();
  });
  it("rolls back invalid slot batches and rejects stale revisions", () => {
    const { editor, mesh, slot } = setup(); const before = mesh();
    const command = { commandId: "paint", type: "material.set_properties", objectId: "box", slot: 0, properties: { color: "#ff0000" } };
    expect(editor.execute("stale", editor.currentRevision - 1, [command]).status).toBe("revision_conflict");
    expect(editor.execute("bad", editor.currentRevision, [command, { ...command, commandId: "invalid", slot: 10 }]).status).toBe("failed");
    expect(mesh()).toBe(before); expect(slot().color.getHexString()).toBe("123456");
    expect(editor.execute("skip", editor.currentRevision, [{ commandId: "skip", type: "material.add_slot", objectId: "box", slot: 2 }]).status).toBe("failed"); editor.reset();
  });
  it("previews a material candidate without touching the live appearance", () => {
    const { editor, slot } = setup();
    const color = editor.withProposalPreview("preview", editor.currentRevision, [{ commandId: "paint", type: "material.set_properties", objectId: "box", slot: 0, properties: { color: "#00ff00" } }], (_scene, candidate) => {
      const object = candidate.getObject("box");
      if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) throw new Error("Missing preview"); return object.material.color.getHexString();
    });
    expect(color).toBe("00ff00"); expect(slot().color.getHexString()).toBe("123456"); editor.reset();
  });
  it("requires explicit replacement for unsupported imported shaders", () => {
    const editor = new EditorScene(new Scene(), "p"); editor.importObject("box", new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: "#123456" })));
    expect(editor.execute("patch", editor.currentRevision, [{ commandId: "patch", type: "material.set_properties", objectId: "box", slot: 0, properties: { color: "#ff0000" } }]).status).toBe("failed");
    expect(editor.execute("replace", editor.currentRevision, [{ commandId: "replace", type: "material.replace_slot", objectId: "box", slot: 0, properties: { color: "#ff0000" } }]).status).toBe("applied");
    const target = editor.getObject("box"); expect(target instanceof Mesh && target.material instanceof MeshStandardMaterial).toBe(true); editor.reset();
  });
  it("can initialize an imported empty material array", () => {
    const editor = new EditorScene(new Scene(), "p"); editor.importObject("box", new Mesh(new BoxGeometry(), []));
    expect(editor.execute("first", editor.currentRevision, [{ commandId: "first", type: "material.add_slot", objectId: "box", slot: 0 }]).status).toBe("applied");
    expect(editor.context({ objectId: "box", meshPath: [], offset: 0, limit: 10, materialsOnly: true }).meshInspection?.materialSlotCount).toBe(1); editor.reset();
  });
  it("reevaluates enabled subdivision after base-face assignment", () => {
    const { editor, mesh } = setup();
    editor.execute("add", editor.currentRevision, [{ commandId: "add", type: "material.add_slot", objectId: "box", slot: 1, properties: { color: "#ff0000" } }]);
    editor.execute("sub", editor.currentRevision, [{ commandId: "sub", type: "geometry.set_modifiers", objectId: "box", modifiers: [{ id: "sub", kind: "subdivision", enabled: true, levels: 1 }] }]);
    expect(editor.execute("assign", editor.currentRevision, [{ commandId: "face", type: "material.assign", objectId: "box", slot: 1, ids: ["0"] }]).status).toBe("applied");
    expect(modifierStack(mesh())?.modifiers[0]?.id).toBe("sub");
    expect(mesh().geometry.groups.some((group) => group.materialIndex === 1)).toBe(true); editor.reset();
  });
});
