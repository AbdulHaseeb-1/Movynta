import { describe, expect, it } from "vitest";
import { Bone, BoxGeometry, BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Scene, Shape, Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute, Vector3 } from "three";
import { EditorScene } from "../assistant/EditorScene";
import { modifyGeometry } from "./meshModifiers";
import { readTopology, topology, assertManifold } from "./meshTopology";

describe("rounded bevel and concave/open surfaces", () => {
  it("produces a closed rounded multi-segment cube", () => {
    const source = new BoxGeometry(2, 2, 2);
    const simple = modifyGeometry(source, { type: "geometry.bevel", width: .2, segments: 1 });
    const rounded = modifyGeometry(source, { type: "geometry.bevel", width: .2, segments: 4 });
    expect(rounded.index?.count ?? 0).toBeGreaterThan(simple.getAttribute("position").count);
    const mesh = readTopology(rounded); expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
    expect(rounded.getAttribute("uv").count).toBe(rounded.getAttribute("position").count);
  });

  it("bevels a concave L-shaped solid", () => {
    const shape = new Shape(); shape.moveTo(0, 0); shape.lineTo(2, 0); shape.lineTo(2, 1); shape.lineTo(1, 1); shape.lineTo(1, 2); shape.lineTo(0, 2); shape.closePath();
    const source = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
    const output = modifyGeometry(source, { type: "geometry.bevel", width: .08, segments: 3 });
    const mesh = readTopology(output); expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
    expect(output.getAttribute("position").array.every(Number.isFinite)).toBe(true);
  });

  it("keeps folded open surfaces open", () => {
    const source = new BufferGeometry().setAttribute("position", new Float32BufferAttribute([0,0,0, 1,0,0, 1,1,0, 0,1,0, 1,0,1, 1,1,1], 3));
    source.setIndex([0,1,2, 0,2,3, 2,1,4, 2,4,5]);
    const output = modifyGeometry(source, { type: "geometry.bevel", width: .1, segments: 3 });
    const mesh = readTopology(output); const graph = topology(mesh);
    expect(() => assertManifold(mesh, graph)).not.toThrow();
    expect([...graph.edges.values()].some((edges) => edges.length === 1)).toBe(true);
  });
});

describe("surface attributes and deformation", () => {
  function deformedGeometry(): BufferGeometry {
    const source = new BoxGeometry(2,2,2); const positions = source.getAttribute("position");
    source.setAttribute("skinIndex", new Uint16BufferAttribute(Array.from({ length: positions.count }, () => [0,1,0,0]).flat(), 4));
    source.setAttribute("skinWeight", new Float32BufferAttribute(Array.from({ length: positions.count }, () => [.75,.25,0,0]).flat(), 4));
    source.setAttribute("color", new Float32BufferAttribute(Array.from({ length: positions.count }, () => [.2,.4,.8]).flat(), 3));
    const target = new Float32BufferAttribute(Array.from({ length: positions.count }, () => [0,.3,0]).flat(), 3); target.name = "Lift";
    source.morphAttributes.position = [target]; source.morphTargetsRelative = true;
    for (const group of source.groups) group.materialIndex = (group.materialIndex ?? 0) % 2;
    return source;
  }
  it.each(["bevel", "subdivision"] as const)("preserves UVs, colors, material groups, skin weights and morphs for %s", (kind) => {
    const source = deformedGeometry();
    const output = modifyGeometry(source, kind === "bevel" ? { type: "geometry.bevel", width: .1, segments: 3 } : { type: "geometry.subdivide", levels: 1 });
    const count = output.getAttribute("position").count;
    for (const attribute of ["uv", "color", "skinIndex", "skinWeight"]) expect(output.getAttribute(attribute).count).toBe(count);
    expect(new Set(output.groups.map((group) => group.materialIndex))).toEqual(new Set([0,1]));
    expect(output.morphTargetsRelative).toBe(true); expect(output.morphAttributes.position?.[0]?.name).toBe("Lift");
    const weights = output.getAttribute("skinWeight"); const target = output.morphAttributes.position?.[0];
    for (let i = 0; i < count; i += 1) {
      expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1);
      expect(target?.getY(i)).toBeCloseTo(.3);
    }
    const mesh = readTopology(output); expect(() => assertManifold(mesh, topology(mesh), true)).not.toThrow();
  });

  it("keeps a textured skinned mesh bound and preserves active morph influences", () => {
    const source = deformedGeometry(); const material = new MeshStandardMaterial({ map: new Texture(), vertexColors: true });
    const mesh = new SkinnedMesh(source, [material, material]); const root = new Bone(); const child = new Bone(); root.add(child); mesh.add(root); mesh.bind(new Skeleton([root, child]));
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[0] = .5;
    const editor = new EditorScene(new Scene(), "p"); editor.importObject("character", mesh);
    const result = editor.execute("smooth", 1, [{ commandId: "smooth", type: "geometry.subdivide", objectId: "character", levels: 1 }]);
    expect(result.status).toBe("applied"); expect(mesh.material).toEqual([material, material]); expect(mesh.skeleton.bones).toEqual([root, child]);
    expect(mesh.morphTargetInfluences?.[0]).toBe(.5);
    const position = mesh.getVertexPosition(0, new Vector3()); expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(true);
    child.position.x = 1; mesh.updateMatrixWorld(true); mesh.skeleton.update();
    const posed = mesh.getVertexPosition(0, new Vector3()); expect(posed.x - position.x).toBeCloseTo(.25);
    expect(mesh.geometry.morphAttributes.normal?.[0]?.count).toBe(mesh.geometry.getAttribute("position").count);
  });

  it.each(["bevel", "subdivision"] as const)("preserves absolute morph coordinates under %s", (kind) => {
    const source = new BoxGeometry(2,2,2); const positions = source.getAttribute("position"); const values: number[] = [];
    for (let i = 0; i < positions.count; i += 1) values.push(positions.getX(i) * 1.2 + .05, positions.getY(i), positions.getZ(i));
    source.morphAttributes.position = [new Float32BufferAttribute(values, 3)]; source.morphTargetsRelative = false;
    const output = modifyGeometry(source, kind === "bevel" ? { type: "geometry.bevel", width: .1, segments: 3 } : { type: "geometry.subdivide", levels: 1 });
    const target = output.morphAttributes.position?.[0]; const base = output.getAttribute("position");
    for (let i = 0; i < base.count; i += 1) expect(target?.getX(i)).toBeCloseTo(base.getX(i) * 1.2 + .05);
  });
});

describe("live modifier stack", () => {
  it("preserves the base and modifier metadata through prepared commits and saved replay", async () => {
    const create = [{ commandId: "c", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 2 }];
    const bevel = [{ commandId: "b", type: "geometry.bevel", objectId: "box", width: .1, segments: 3 }];
    const clear = [{ commandId: "clear", type: "geometry.set_modifiers", objectId: "box", modifiers: [] }];
    const editor = new EditorScene(new Scene(), "p"); editor.execute("create", 0, create); editor.execute("bevel", 1, bevel);
    editor.executePrepared("clear", 2, clear, "prepare"); editor.executePrepared("clear", 2, clear, "commit");
    expect(editor.context({ objectId: "box", meshPath: [], offset: 0, limit: 1 }).meshInspection?.stats?.triangles).toBe(12);
    const replay = new EditorScene(new Scene(), "p");
    await replay.restore([{ kind: "commands", proposalId: "c", commands: create }, { kind: "commands", proposalId: "b", commands: bevel }], () => Promise.reject(new Error("Unexpected import")));
    expect(replay.context({ objectId: "box", meshPath: [], offset: 0, limit: 1 }).meshInspection?.modifiers?.[0]).toMatchObject({ kind: "bevel", segments: 3 });
    replay.execute("clear", replay.currentRevision, clear);
    expect(replay.context({ objectId: "box", meshPath: [], offset: 0, limit: 1 }).meshInspection?.stats?.triangles).toBe(12);
  });
  it("edits, disables, reorders, removes and restores modifiers from the base mesh", () => {
    const editor = new EditorScene(new Scene(), "p"); const source = new BoxGeometry(2,2,2); const mesh = new Mesh(source); editor.importObject("mesh", mesh);
    const set = (id: string, modifiers: unknown[]) => editor.execute(id, editor.currentRevision, [{ commandId: id, type: "geometry.set_modifiers", objectId: "mesh", modifiers }]);
    const bevel = { id: "bevel", kind: "bevel", enabled: true, width: .1, segments: 3 };
    const smooth = { id: "smooth", kind: "subdivision", enabled: true, levels: 1 };
    expect(set("both", [bevel, smooth]).status).toBe("applied");
    const both = mesh.geometry.getAttribute("position").count;
    expect(set("disable", [{ ...bevel, enabled: false }, smooth]).status).toBe("applied");
    expect(mesh.geometry.getAttribute("position").count).toBeLessThan(both);
    expect(set("width", [{ ...bevel, width: .2 }]).status).toBe("applied");
    expect(set("remove", []).status).toBe("applied");
    expect([...mesh.geometry.getAttribute("position").array]).toEqual([...source.getAttribute("position").array]);
    expect(editor.context({ objectId: "mesh", meshPath: [], offset: 0, limit: 1 }).meshInspection?.modifiers).toEqual([]);
    expect(set("reordered", [smooth, bevel]).status).toBe("applied");
    const before = mesh.geometry;
    expect(set("invalid", [{ ...bevel, width: 99 }]).status).toBe("failed"); expect(mesh.geometry).toBe(before);
  });
});
