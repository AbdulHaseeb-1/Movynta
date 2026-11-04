import { beforeAll, describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SkinnedMesh,
  Vector3,
  type Object3D,
} from "three";
import { getManifoldModuleSync } from "manifold-3d/lib/wasm.js";
import { EditorScene } from "../assistant/EditorScene";
import { applyBoolean, ensureManifold } from "./meshBoolean";
import { assertManifold, readTopology, topology } from "./meshTopology";

beforeAll(async () => {
  await ensureManifold();
});

function volumeOf(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let signed = 0;
  const triangles = Math.floor((index ? index.count : position.count) / 3);
  for (let tri = 0; tri < triangles; tri += 1) {
    const base = tri * 3;
    a.fromBufferAttribute(position, index ? index.getX(base) : base);
    b.fromBufferAttribute(position, index ? index.getX(base + 1) : base + 1);
    c.fromBufferAttribute(position, index ? index.getX(base + 2) : base + 2);
    signed += a.dot(b.clone().cross(c));
  }
  return Math.abs(signed) / 6;
}

function expectClosed(geometry: BufferGeometry): void {
  const cage = readTopology(geometry);
  expect(() => assertManifold(cage, topology(cage), true)).not.toThrow();
}

function near(geometry: BufferGeometry, point: Vector3, epsilon = 1e-3): boolean {
  const position = geometry.getAttribute("position");
  const found = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    if (found.fromBufferAttribute(position, index).distanceTo(point) <= epsilon) return true;
  }
  return false;
}

function withinCube(geometry: BufferGeometry): boolean {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    if (x < -0.501 || x > 0.501 || y < -0.501 || y > 0.501 || z < -0.501 || z > 0.501) return false;
    if (x > 0.01 && y > 0.01 && z > 0.01) return false;
  }
  return true;
}

function heapBytes(): number {
  const api: unknown = getManifoldModuleSync();
  if (!api || typeof api !== "object" || !("HEAPU8" in api)) return 0;
  const heap = api.HEAPU8;
  return heap instanceof Uint8Array ? heap.buffer.byteLength : 0;
}

function editorWithCut(): EditorScene {
  const editor = new EditorScene(new Scene(), "p");
  editor.execute("box", 0, [{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 1 }]);
  editor.execute("cutter", 1, [{ commandId: "cutter", type: "geometry.create_primitive", objectId: "cutter", primitive: "box", size: 1 }]);
  editor.execute("place", 2, [{ commandId: "place", type: "scene.transform_object", objectId: "cutter", transform: { position: [0.5, 0.5, 0.5] } }]);
  return editor;
}

function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}

function meshOf(editor: EditorScene, id: string): Mesh {
  const object = editor.getObject(id);
  if (!isMesh(object)) throw new Error(`Missing mesh ${id}`);
  return object;
}

function cutModifier(operandObjectId: string, operation: "difference" | "union" | "intersect" = "difference") {
  return { id: "cut", kind: "boolean" as const, enabled: true, operation, operandObjectId, operandMeshPath: [] as number[] };
}

function setCut(editor: EditorScene, operation: "difference" | "union" | "intersect" = "difference") {
  return editor.execute("cut", editor.currentRevision, [{
    commandId: "cut",
    type: "geometry.set_modifiers",
    objectId: "box",
    modifiers: [cutModifier("cutter", operation)],
  }]);
}

describe("manifold boolean", () => {
  const overlap = new Matrix4().makeTranslation(0.5, 0.5, 0.5);

  it("recomputes only Boolean results affected by a moved cutter", () => {
    const editor = editorWithCut();
    expect(setCut(editor).status).toBe("applied");
    editor.execute("other", editor.currentRevision, [
      { commandId: "other", type: "geometry.create_primitive", objectId: "other", primitive: "box", size: 1 },
      { commandId: "other-cutter", type: "geometry.create_primitive", objectId: "other-cutter", primitive: "box", size: 1 },
      { commandId: "place-other", type: "scene.transform_object", objectId: "other-cutter", transform: { position: [0.5, 0.5, 0.5] } },
    ]);
    expect(editor.execute("other-cut", editor.currentRevision, [{
      commandId: "other-cut", type: "geometry.boolean", objectId: "other", operandObjectId: "other-cutter",
    }]).status).toBe("applied");
    editor.select("cutter");
    const changed = meshOf(editor, "box").geometry;
    const untouched = meshOf(editor, "other").geometry;
    meshOf(editor, "cutter").position.x = 0.6;
    editor.previewBooleans();
    expect(meshOf(editor, "box").geometry).not.toBe(changed);
    expect(meshOf(editor, "other").geometry).toBe(untouched);
  });

  it("prepares and commits a circular bevel after a Boolean cut in one batch", () => {
    const editor = editorWithCut();
    const revision = editor.currentRevision;
    const original = meshOf(editor, "box").geometry;
    const commands = [
      { commandId: "cut", type: "geometry.boolean", objectId: "box", operandObjectId: "cutter" },
      { commandId: "round", type: "geometry.bevel", objectId: "box", width: 0.035, segments: 4, profile: "circular", angle: 25 },
    ];
    const preview = editor.executePrepared("rounded-cut", revision, commands, "prepare");
    expect("message" in preview ? preview.message : undefined).toBeUndefined();
    expect(preview.status).toBe("applied");
    expect(meshOf(editor, "box").geometry).toBe(original);
    expect(editor.executePrepared("rounded-cut", revision, commands, "commit").status).toBe("applied");
    const rounded = meshOf(editor, "box").geometry;
    expectClosed(rounded);
    expect(volumeOf(rounded)).toBeGreaterThan(0.86);
    expect(volumeOf(rounded)).toBeLessThan(0.875);
  });

  it("uses an explicit target material on the cut and rejects unavailable slots atomically", () => {
    const editor = editorWithCut();
    const box = meshOf(editor, "box");
    box.material = [new MeshStandardMaterial(), new MeshStandardMaterial()];
    box.geometry.groups.forEach((group) => { group.materialIndex = 0; });
    expect(editor.context({ objectId: "box", meshPath: [], offset: 0, limit: 1 }).meshInspection?.stats?.materialSlots).toBe(2);
    const cut = { commandId: "cut", type: "geometry.boolean", objectId: "box", operandObjectId: "cutter", cutMaterialIndex: 1 };
    expect(editor.execute("cut", editor.currentRevision, [cut]).status).toBe("applied");
    const geometry = box.geometry;
    expect(new Set(geometry.groups.map((group) => group.materialIndex))).toEqual(new Set([0, 1]));
    expect(editor.execute("bad-slot", editor.currentRevision, [{ ...cut, commandId: "bad", cutMaterialIndex: 2 }]).status).toBe("failed");
    expect(box.geometry).toBe(geometry);
  });

  it("keeps a cylindrical through-hole closed and bevels its sharp rim", () => {
    const editor = editorWithCut();
    editor.importObject("drill", new Mesh(new CylinderGeometry(0.2, 0.2, 2, 24)));
    const commands = [
      { commandId: "drill", type: "geometry.boolean", objectId: "box", operandObjectId: "drill" },
      { commandId: "rim", type: "geometry.bevel", objectId: "box", width: 0.01, segments: 3, profile: "circular", angle: 30 },
    ];
    const result = editor.execute("through-hole", editor.currentRevision, commands);
    expect("message" in result ? result.message : undefined).toBeUndefined();
    expect(result.status).toBe("applied");
    const geometry = meshOf(editor, "box").geometry;
    expectClosed(geometry);
    const raw = geometry.clone();
    expectClosed(raw);
    raw.dispose();
    expect(volumeOf(geometry)).toBeGreaterThan(0.85);
    expect(volumeOf(geometry)).toBeLessThan(0.89);
  });

  it("cuts a unit cube corner to volume 0.875", () => {
    const result = applyBoolean(new BoxGeometry(1, 1, 1), new BoxGeometry(1, 1, 1), "difference", overlap);
    expect(volumeOf(result)).toBeCloseTo(0.875, 4);
    expectClosed(result);
    expect(withinCube(result)).toBe(true);
    expect(near(result, new Vector3(-0.5, -0.5, -0.5))).toBe(true);
    expect(near(result, new Vector3(0.5, 0.5, 0.5))).toBe(false);
    result.dispose();
  });

  it("leaves volume 1 when the cutter misses, and unions and intersects the overlap", () => {
    const target = new BoxGeometry(1, 1, 1);
    const cutter = new BoxGeometry(1, 1, 1);
    const missed = applyBoolean(target, cutter, "difference", new Matrix4().makeTranslation(3, 0, 0));
    const united = applyBoolean(target, cutter, "union", overlap);
    const shared = applyBoolean(target, cutter, "intersect", overlap);
    expect(volumeOf(missed)).toBeCloseTo(1, 4);
    expect(volumeOf(united)).toBeCloseTo(1.875, 4);
    expect(volumeOf(shared)).toBeCloseTo(0.125, 4);
    missed.dispose();
    united.dispose();
    shared.dispose();
  });

  it("keeps a closed solid for a rotated, scaled, and mirrored cutter", () => {
    const target = new BoxGeometry(1, 1, 1);
    const slab = new BoxGeometry(4, Math.SQRT2 / 4, 4);
    const rotated = applyBoolean(target, slab, "intersect", new Matrix4().makeRotationZ(Math.PI / 4));
    const cut = applyBoolean(target, slab, "difference", new Matrix4().makeRotationZ(Math.PI / 4));
    const scaled = applyBoolean(target, new BoxGeometry(1, 1, 1), "intersect", new Matrix4().makeScale(0.5, 2, 2));
    const mirrored = applyBoolean(target, new BoxGeometry(1, 1, 1), "difference", new Matrix4().makeScale(-1, 1, 1).setPosition(0.5, 0.5, 0.5));
    expect(volumeOf(rotated)).toBeCloseTo(0.4375, 4);
    expect(volumeOf(cut)).toBeCloseTo(0.5625, 4);
    expect(volumeOf(scaled)).toBeCloseTo(0.5, 4);
    expect(volumeOf(mirrored)).toBeCloseTo(0.875, 4);
    for (const geometry of [rotated, cut, scaled, mirrored]) {
      expectClosed(geometry);
      geometry.dispose();
    }
  });

  it("keeps an uncut corner's UV and splits materials by source", () => {
    const target = new BoxGeometry(1, 1, 1);
    const cutter = new BoxGeometry(1, 1, 1);
    for (const group of target.groups) group.materialIndex = 0;
    for (const group of cutter.groups) group.materialIndex = 1;
    const corner = new Vector3(-0.5, -0.5, -0.5);
    const sourceUv = target.getAttribute("uv");
    const sourcePosition = target.getAttribute("position");
    const originals: number[][] = [];
    for (let index = 0; index < sourcePosition.count; index += 1) {
      if (new Vector3().fromBufferAttribute(sourcePosition, index).distanceTo(corner) > 1e-4) continue;
      originals.push([sourceUv.getX(index), sourceUv.getY(index)]);
    }
    const colors = new Float32Array(sourcePosition.count * 3);
    for (let index = 0; index < sourcePosition.count; index += 1) {
      const kept = new Vector3().fromBufferAttribute(sourcePosition, index).distanceTo(corner) <= 1e-4;
      colors[index * 3] = kept ? 0.2 : 0.8;
      colors[index * 3 + 1] = kept ? 0.4 : 0.1;
      colors[index * 3 + 2] = kept ? 0.6 : 0.1;
    }
    target.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const result = applyBoolean(target, cutter, "difference", overlap);
    const uv = result.getAttribute("uv");
    const color = result.getAttribute("color");
    const position = result.getAttribute("position");
    let matched = false;
    for (let index = 0; index < position.count; index += 1) {
      if (new Vector3().fromBufferAttribute(position, index).distanceTo(corner) > 1e-3) continue;
      matched = originals.some(([u, v]) => Math.abs(uv.getX(index) - (u ?? 0)) < 1e-3 && Math.abs(uv.getY(index) - (v ?? 0)) < 1e-3);
      expect(color.getX(index)).toBeCloseTo(0.2, 2);
      expect(color.getY(index)).toBeCloseTo(0.4, 2);
      expect(color.getZ(index)).toBeCloseTo(0.6, 2);
      if (matched) break;
    }
    expect(matched).toBe(true);
    expect(new Set(result.groups.map((group) => group.materialIndex ?? 0))).toEqual(new Set([0, 1]));
    result.dispose();
  });

  it("rejects open, non-manifold, skinned, morph, and empty input", () => {
    const solid = new BoxGeometry(1, 1, 1);
    const open = new PlaneGeometry(1, 1);
    const nonManifold = new BufferGeometry();
    nonManifold.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1], 3));
    nonManifold.setIndex([0, 1, 2, 0, 1, 3, 0, 1, 4]);
    const morphed = solid.clone();
    morphed.morphAttributes.position = [solid.getAttribute("position").clone()];
    const skinned = solid.clone();
    skinned.setAttribute("skinIndex", new Float32BufferAttribute(new Array(solid.getAttribute("position").count * 4).fill(0), 4));
    skinned.setAttribute("skinWeight", new Float32BufferAttribute(new Array(solid.getAttribute("position").count * 4).fill(0.25), 4));
    const contained = new BoxGeometry(4, 4, 4);
    expect(() => applyBoolean(open, solid, "difference", new Matrix4())).toThrow(/closed solid/);
    expect(() => applyBoolean(nonManifold, solid, "difference", new Matrix4())).toThrow(/manifold solid/);
    expect(() => applyBoolean(skinned, solid, "difference", new Matrix4())).toThrow(/skinned/);
    expect(() => applyBoolean(morphed, solid, "difference", new Matrix4())).toThrow(/morph/);
    expect(() => applyBoolean(solid, contained, "difference", new Matrix4())).toThrow(/entire mesh/);
    open.dispose();
    nonManifold.dispose();
    morphed.dispose();
    skinned.dispose();
    contained.dispose();
  });

  it("does not grow the wasm heap across repeated cuts", () => {
    const target = new BoxGeometry(1, 1, 1);
    const cutter = new BoxGeometry(1, 1, 1);
    const warm = applyBoolean(target, cutter, "difference", overlap);
    warm.dispose();
    const before = heapBytes();
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const result = applyBoolean(target, cutter, "difference", overlap);
      result.dispose();
    }
    expect(heapBytes()).toBe(before);
  });
});

describe("boolean modifier stack", () => {
  it("updates the cut when only the cutter moves and restores it when the cutter returns", () => {
    const editor = editorWithCut();
    expect(setCut(editor).status).toBe("applied");
    const box = meshOf(editor, "box");
    const snapshot = [...box.geometry.getAttribute("position").array];
    expect(volumeOf(box.geometry)).toBeCloseTo(0.875, 4);
    editor.execute("away", editor.currentRevision, [{ commandId: "away", type: "scene.transform_object", objectId: "cutter", transform: { position: [3, 0, 0] } }]);
    expect(volumeOf(box.geometry)).toBeCloseTo(1, 4);
    editor.execute("back", editor.currentRevision, [{ commandId: "back", type: "scene.transform_object", objectId: "cutter", transform: { position: [0.5, 0.5, 0.5] } }]);
    const restored = box.geometry.getAttribute("position").array;
    expect(restored.length).toBe(snapshot.length);
    snapshot.forEach((value, index) => expect(restored[index] ?? 0).toBeCloseTo(value, 4));
  });

  it("keeps the local result when both objects move together", () => {
    const editor = editorWithCut();
    setCut(editor);
    const box = meshOf(editor, "box");
    const snapshot = [...box.geometry.getAttribute("position").array];
    editor.execute("shift", editor.currentRevision, [
      { commandId: "shift-box", type: "scene.transform_object", objectId: "box", transform: { position: [2, 0, 0] } },
      { commandId: "shift-cutter", type: "scene.transform_object", objectId: "cutter", transform: { position: [2.5, 0.5, 0.5] } },
    ]);
    const moved = box.geometry.getAttribute("position").array;
    expect(moved.length).toBe(snapshot.length);
    snapshot.forEach((value, index) => expect(moved[index] ?? 0).toBeCloseTo(value, 4));
    expect(volumeOf(box.geometry)).toBeCloseTo(0.875, 4);
  });

  it("uses the operand's modifiers from the same batch", () => {
    const editor = editorWithCut();
    const result = editor.execute("batch", editor.currentRevision, [
      { commandId: "sub", type: "geometry.subdivide", objectId: "cutter", levels: 1 },
      { commandId: "cut", type: "geometry.set_modifiers", objectId: "box", modifiers: [cutModifier("cutter")] },
    ]);
    expect(result.status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).not.toBeCloseTo(0.875, 2);
    expectClosed(meshOf(editor, "box").geometry);
  });

  it("subdivides the boolean result and can disable the cut", () => {
    const editor = editorWithCut();
    setCut(editor);
    const cutTriangles = (meshOf(editor, "box").geometry.index?.count ?? 0) / 3;
    const stacked = editor.execute("stack", editor.currentRevision, [{
      commandId: "stack",
      type: "geometry.set_modifiers",
      objectId: "box",
      modifiers: [cutModifier("cutter"), { id: "sub", kind: "subdivision", enabled: true, levels: 1 }],
    }]);
    expect(stacked.status).toBe("applied");
    const smoothed = meshOf(editor, "box").geometry;
    expect((smoothed.index?.count ?? 0) / 3).toBeGreaterThan(cutTriangles);
    expectClosed(smoothed);
    const disabled = editor.execute("off", editor.currentRevision, [{
      commandId: "off",
      type: "geometry.set_modifiers",
      objectId: "box",
      modifiers: [{ ...cutModifier("cutter"), enabled: false }],
    }]);
    expect(disabled.status).toBe("applied");
    expect(volumeOf(meshOf(editor, "box").geometry)).toBeCloseTo(1, 4);
  });

  it("replays a saved boolean and restores the base when the modifier is cleared", async () => {
    const createBox = [{ commandId: "box", type: "geometry.create_primitive", objectId: "box", primitive: "box", size: 1 }];
    const createCutter = [{ commandId: "cutter", type: "geometry.create_primitive", objectId: "cutter", primitive: "box", size: 1 }];
    const place = [{ commandId: "place", type: "scene.transform_object", objectId: "cutter", transform: { position: [0.5, 0.5, 0.5] } }];
    const cut = [{ commandId: "cut", type: "geometry.set_modifiers", objectId: "box", modifiers: [cutModifier("cutter")] }];
    const replay = new EditorScene(new Scene(), "p");
    await replay.restore([
      { kind: "commands", proposalId: "box", commands: createBox },
      { kind: "commands", proposalId: "cutter", commands: createCutter },
      { kind: "commands", proposalId: "place", commands: place },
      { kind: "commands", proposalId: "cut", commands: cut },
    ], () => Promise.reject(new Error("Unexpected import")));
    expect(volumeOf(meshOf(replay, "box").geometry)).toBeCloseTo(0.875, 4);
    const undone = new EditorScene(new Scene(), "p");
    await undone.restore([
      { kind: "commands", proposalId: "box", commands: createBox },
      { kind: "commands", proposalId: "cutter", commands: createCutter },
      { kind: "commands", proposalId: "place", commands: place },
    ], () => Promise.reject(new Error("Unexpected import")));
    expect(volumeOf(meshOf(undone, "box").geometry)).toBeCloseTo(1, 4);
    replay.execute("clear", replay.currentRevision, [{ commandId: "clear", type: "geometry.set_modifiers", objectId: "box", modifiers: [] }]);
    expect(volumeOf(meshOf(replay, "box").geometry)).toBeCloseTo(1, 4);
  });

  it("rolls back failed booleans without changing the mesh or revision", () => {
    const editor = editorWithCut();
    const box = meshOf(editor, "box");
    const geometry = box.geometry;
    const failed = (result: { status: string; message?: string }) => {
      expect(result.status).toBe("failed");
      return result.message ?? "";
    };
    const planeGeometry = (() => {
      editor.execute("plane", editor.currentRevision, [{ commandId: "plane", type: "geometry.create_primitive", objectId: "plane", primitive: "plane", size: 1 }]);
      return meshOf(editor, "plane").geometry;
    })();
    const planeRevision = editor.currentRevision;
    expect(failed(editor.execute("open", planeRevision, [{
      commandId: "open", type: "geometry.set_modifiers", objectId: "plane", modifiers: [cutModifier("cutter")],
    }]))).toMatch(/closed solid/);
    expect(meshOf(editor, "plane").geometry).toBe(planeGeometry);
    expect(editor.currentRevision).toBe(planeRevision);

    const broken = new BufferGeometry();
    broken.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1], 3));
    broken.setIndex([0, 1, 2, 0, 1, 3, 0, 1, 4]);
    editor.importObject("broken", new Mesh(broken));
    const brokenGeometry = meshOf(editor, "broken").geometry;
    const brokenRevision = editor.currentRevision;
    expect(failed(editor.execute("bad", brokenRevision, [{
      commandId: "bad", type: "geometry.set_modifiers", objectId: "broken", modifiers: [cutModifier("cutter")],
    }]))).toMatch(/manifold solid/);
    expect(meshOf(editor, "broken").geometry).toBe(brokenGeometry);
    expect(editor.currentRevision).toBe(brokenRevision);

    const morphed = new BoxGeometry(1, 1, 1);
    morphed.morphAttributes.position = [morphed.getAttribute("position").clone()];
    editor.importObject("morphed", new Mesh(morphed));
    expect(failed(editor.execute("morph", editor.currentRevision, [{
      commandId: "morph", type: "geometry.set_modifiers", objectId: "morphed", modifiers: [cutModifier("cutter")],
    }]))).toMatch(/morph/);

    editor.importObject("skinned", new SkinnedMesh(new BoxGeometry(1, 1, 1)));
    expect(failed(editor.execute("skin", editor.currentRevision, [{
      commandId: "skin", type: "geometry.set_modifiers", objectId: "skinned", modifiers: [cutModifier("cutter")],
    }]))).toMatch(/skinned/);

    editor.execute("huge", editor.currentRevision, [{ commandId: "huge", type: "geometry.create_primitive", objectId: "huge", primitive: "box", size: 4 }]);
    const settled = editor.currentRevision;
    expect(failed(editor.execute("empty", settled, [{
      commandId: "empty", type: "geometry.set_modifiers", objectId: "box", modifiers: [cutModifier("huge")],
    }]))).toMatch(/entire mesh/);
    expect(failed(editor.execute("self", settled, [{
      commandId: "self", type: "geometry.set_modifiers", objectId: "box", modifiers: [cutModifier("box")],
    }]))).toMatch(/own mesh/);
    expect(failed(editor.execute("missing", settled, [{
      commandId: "missing", type: "geometry.set_modifiers", objectId: "box", modifiers: [cutModifier("absent")],
    }]))).toMatch(/does not exist/);
    expect(failed(editor.execute("cycle", settled, [
      { commandId: "cycle-box", type: "geometry.set_modifiers", objectId: "box", modifiers: [cutModifier("cutter")] },
      { commandId: "cycle-cutter", type: "geometry.set_modifiers", objectId: "cutter", modifiers: [cutModifier("box")] },
    ]))).toMatch(/cycle/);
    expect(box.geometry).toBe(geometry);
    expect(editor.currentRevision).toBe(settled);
  });

  it("refuses to delete an operand and rolls a zero scale back", () => {
    const editor = editorWithCut();
    setCut(editor);
    const box = meshOf(editor, "box");
    const geometry = box.geometry;
    const revision = editor.currentRevision;
    const removed = editor.execute("delete", revision, [{ commandId: "delete", type: "scene.delete_object", objectId: "cutter" }]);
    expect(removed.status).toBe("failed");
    expect(removed.message).toMatch(/Remove the Boolean modifier/);
    expect(editor.getObject("cutter")).toBeDefined();
    expect(editor.currentRevision).toBe(revision);
    expect(box.geometry).toBe(geometry);
    const collapsed = editor.execute("scale", revision, [{
      commandId: "scale", type: "scene.transform_object", objectId: "box", transform: { scale: [0, 1, 1] },
    }]);
    expect(collapsed.status).toBe("failed");
    expect(collapsed.message).toMatch(/inverted|entire mesh|manifold/);
    expect(editor.currentRevision).toBe(revision);
    expect(box.geometry).toBe(geometry);
    expect(box.scale.x).toBeCloseTo(1, 5);
  });
});
