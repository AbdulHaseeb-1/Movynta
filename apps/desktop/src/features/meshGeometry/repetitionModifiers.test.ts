import { describe, expect, it } from "vitest";
import { BoxGeometry, Float32BufferAttribute, Mesh, Scene, Vector3 } from "three";
import type { MeshModifierSpec } from "@movynta/editor-protocol";
import { repeatGeometry } from "./repetitionModifiers";
import { assertManifold, readTopology, topology } from "./meshTopology";
import { EditorScene } from "../assistant/EditorScene";
import { modifierStack } from "./modifierStack";

const mirror = (axis: "x" | "y" | "z" = "x"): Extract<MeshModifierSpec, { kind: "mirror" }> => ({ id: "symmetry", kind: "mirror", enabled: true, axis, origin: 0, bisect: true, keepSide: "positive", mergeDistance: 1e-6 });
function volume(mesh: ReturnType<typeof readTopology>) {
  let result = 0;
  for (const face of mesh.faces) {
    const a = mesh.positions[face[0] ?? -1]; if (!a) continue;
    for (let i = 1; i < face.length - 1; i++) {
      const b = mesh.positions[face[i] ?? -1], c = mesh.positions[face[i + 1] ?? -1];
      if (b && c) result += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return result;
}
describe("live repetition modifiers", () => {
  it("arrays independent control islands with stable source-face mappings and materials", () => {
    const source = new BoxGeometry(), original = readTopology(source);
    const output = repeatGeometry(source, { id: "array", kind: "array", enabled: true, count: 3, offset: [2, 0, 0] }, true);
    const cage = readTopology(output);
    expect(cage.faces).toHaveLength(original.faces.length * 3); expect(cage.positions).toHaveLength(original.positions.length * 3);
    expect(output.boundingBox?.getSize(new Vector3()).toArray()).toEqual([5, 1, 1]);
    expect(cage.faceSources?.slice(original.faces.length, original.faces.length * 2)).toEqual(original.faces.map((_, i) => i));
    expect(cage.channels?.materials).toEqual([...(original.channels?.materials ?? []), ...(original.channels?.materials ?? []), ...(original.channels?.materials ?? [])]);
    expect(volume(cage)).toBeCloseTo(3); output.dispose(); source.dispose();
  });
  it.each(["x", "y", "z"] as const)("bisects and reflects a cube across %s with outward winding and welded seams", (axis) => {
    const source = new BoxGeometry(2, 2, 2), output = repeatGeometry(source, mirror(axis), true), cage = readTopology(output);
    expect(() => assertManifold(cage, topology(cage), true)).not.toThrow();
    expect(volume(cage)).toBeCloseTo(8);
    expect(output.boundingBox?.getSize(new Vector3()).toArray()).toEqual([2, 2, 2]);
    expect(output.getAttribute("uv")).toBeDefined();
    const normals = output.getAttribute("normal");
    for (let i = 0; i < normals.count; i++) expect(new Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1);
    output.dispose(); source.dispose();
  });
  it("keeps the negative side and reflects around an offset local plane", () => {
    const source = new BoxGeometry(2, 2, 2); source.translate(5, 0, 0);
    const output = repeatGeometry(source, { ...mirror(), origin: 5, keepSide: "negative" }, true);
    expect(output.boundingBox?.min.x).toBeCloseTo(4); expect(output.boundingBox?.max.x).toBeCloseTo(6);
    expect(volume(readTopology(output))).toBeCloseTo(8); output.dispose(); source.dispose();
  });
  it("rejects crossing an unbisected source and unsupported morph deformation", () => {
    const source = new BoxGeometry();
    expect(() => repeatGeometry(source, { ...mirror(), bisect: false }, true)).toThrow("enable bisect");
    source.morphAttributes.position = [new Float32BufferAttribute(new Float32Array(source.getAttribute("position").count * 3), 3)];
    expect(() => repeatGeometry(source, mirror(), true)).toThrow("deformation"); source.dispose();
  });
  it("rebuilds symmetry after base edits and disabling it restores the original cage", () => {
    const editor = new EditorScene(new Scene(), "p"), mesh = new Mesh(new BoxGeometry()); editor.importObject("box", mesh);
    expect(editor.execute("mirror", editor.currentRevision, [{ commandId: "mirror", type: "geometry.set_modifiers", objectId: "box", modifiers: [mirror()] }]).status).toBe("applied");
    const base = readTopology(modifierStack(mesh)?.base ?? mesh.geometry);
    const vertex = base.positions.findIndex((p) => p.x > 0);
    expect(editor.execute("edit", editor.currentRevision, [{ commandId: "edit", type: "geometry.transform_components", objectId: "box", kind: "vertex", ids: [String(vertex)], componentView: "base", transform: { position: [0.2, 0, 0] } }]).status).toBe("applied");
    mesh.geometry.computeBoundingBox(); expect(mesh.geometry.boundingBox?.max.x).toBeCloseTo(0.7); expect(mesh.geometry.boundingBox?.min.x).toBeCloseTo(-0.7);
    expect(editor.execute("off", editor.currentRevision, [{ commandId: "off", type: "geometry.set_modifiers", objectId: "box", modifiers: [{ ...mirror(), enabled: false }] }]).status).toBe("applied");
    mesh.geometry.computeBoundingBox(); expect(mesh.geometry.boundingBox?.min.x).toBeCloseTo(-0.5); editor.reset();
  });
});
