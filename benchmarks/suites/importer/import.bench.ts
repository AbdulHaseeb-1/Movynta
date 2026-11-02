/*
 * BENCH: Preparing and reading model files for import
 * TIER: HIGH
 * SUBJECT: apps/desktop/src/features/importer/prepareModel.ts#prepareModel, #disposeModel, parseModel.ts#parseModel (OBJ, STL)
 *          and objectId.ts#makeObjectId, modelFormats.ts helpers
 * MEASURES: latency
 * COMPLEXITY: prepareModel O(vertices + nodes); parseModel O(file size); makeObjectId O(1)
 * INPUTS: triangles 25k..400k in one mesh; parts 1k..16k; file size up to ~25 MB; seed 20260402
 * BASELINE: baselines/importer/import.baseline.json
 * THRESHOLD: fail if median regresses >25% (and beyond 3x the baseline spread) or p95 >40%
 * EXCLUDES: reading the file from disk, the upload, GPU upload of geometry
 * NOTES: runs once per import on a file the user chose, but a 400k-triangle model must not freeze the window
 *        for long. The loaders are three.js's; this measures our wrappers around them and the loaders at
 *        realistic sizes.
 */
import { describe, it } from "vitest";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from "three";
import { formatFileSize, modelFormatOf, unsupportedFileMessage } from "@/features/importer/modelFormats";
import { makeObjectId } from "@/features/importer/objectId";
import { parseModel } from "@/features/importer/parseModel";
import { disposeModel, prepareModel } from "@/features/importer/prepareModel";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";
import { denseMesh, seededRandom } from "../../fixtures/scene.fixtures";

/** A model of `parts` separate meshes sharing one geometry, like an exported scene. */
function manyParts(parts: number): Group {
  const random = seededRandom();
  const geometry = new BoxGeometry(0.3, 0.3, 0.3);
  const material = new MeshStandardMaterial();
  const group = new Group();
  for (let index = 0; index < parts; index += 1) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set((random() - 0.5) * 20, (random() - 0.5) * 20, (random() - 0.5) * 20);
    group.add(mesh);
  }
  return group;
}

/** An OBJ file of about `triangles` triangles: a strip of triangles over a grid of vertices. */
function objText(triangles: number): ArrayBuffer {
  const columns = 300;
  const lines: string[] = ["o grid"];
  const vertexCount = Math.ceil(triangles / 2) + columns + 2;
  for (let index = 0; index < vertexCount; index += 1)
    lines.push(`v ${(index % columns) * 0.01} ${Math.floor(index / columns) * 0.01} ${((index * 7) % 5) * 0.001}`);
  for (let tri = 0; tri < triangles; tri += 1) {
    const base = Math.floor(tri / 2) + 1;
    lines.push(tri % 2 === 0 ? `f ${base} ${base + 1} ${base + columns}` : `f ${base + 1} ${base + columns + 1} ${base + columns}`);
  }
  return new TextEncoder().encode(lines.join("\n")).buffer;
}

/** A binary STL file of `triangles` triangles. */
function stlBinary(triangles: number): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  const random = seededRandom();
  for (let tri = 0; tri < triangles; tri += 1) {
    let at = 84 + tri * 50 + 12;
    for (let corner = 0; corner < 9; corner += 1) {
      view.setFloat32(at, random(), true);
      at += 4;
    }
  }
  return buffer;
}

describe("importing a model", () => {
  it("prepares a model with one dense mesh in time linear in its size", async () => {
    const cases: BenchCase[] = [25_000, 50_000, 100_000, 200_000, 400_000].map((triangles) => {
      // The bounding box of a geometry is cached on the geometry, so every run starts from a fresh model,
      // built outside the timed region and released before the next one.
      let model = denseMesh(triangles);
      let prepared: ReturnType<typeof prepareModel> | undefined;
      return {
        name: "prepareModel (dense mesh)",
        params: { triangles },
        prepare: () => {
          if (prepared) disposeModel(prepared.object);
          model = denseMesh(triangles);
        },
        run: () => {
          prepared = prepareModel(model, "model.glb");
          consume(prepared.triangles);
        },
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("importer/import.dense", results, [{ key: "triangles", declared: 1, tolerance: 0.5 }]);
  });

  it("prepares a model with many parts in time linear in the number of parts", async () => {
    const cases: BenchCase[] = [1000, 2000, 4000, 8000, 16000].map((parts) => {
      let model = manyParts(parts);
      return {
        name: "prepareModel (many parts)",
        params: { parts },
        prepare: () => {
          model = manyParts(parts);
        },
        run: () => consume(prepareModel(model, "scene.glb").triangles),
      };
    });
    const results = await measureCases(cases);
    finishWithGrowth("importer/import.parts", results, [{ key: "parts", declared: 1, tolerance: 0.5 }]);
  });

  it("reads OBJ and STL files in time linear in file size", async () => {
    const cases: BenchCase[] = [25_000, 50_000, 100_000, 200_000].flatMap((triangles) => {
      const obj = objText(triangles);
      const stl = stlBinary(triangles);
      return [
        { name: "parseModel (obj)", params: { triangles }, async: true, run: async () => consume(await parseModel("obj", obj)) },
        { name: "parseModel (stl)", params: { triangles }, async: true, run: async () => consume(await parseModel("stl", stl)) },
      ];
    });
    const results = await measureCases(cases);
    finishWithGrowth("importer/import.parse", results, [
      { key: "triangles", declared: 1, label: "obj", where: (result) => result.name.includes("obj"), tolerance: 0.5 },
      { key: "triangles", declared: 1, label: "stl", where: (result) => result.name.includes("stl"), tolerance: 0.5 },
    ]);
  });

  it("names and classifies files in constant time", async () => {
    const taken = new Set(Array.from({ length: 2000 }, (_, index) => `model_${index.toString(16).padStart(4, "0")}`));
    const results = await measureCases([
      { name: "makeObjectId (2000 taken)", params: { taken: 2000 }, run: () => consume(makeObjectId("Robot v2 (final).glb", taken).length) },
      { name: "modelFormatOf", params: { calls: 1 }, run: () => consume(modelFormatOf("Some Model.v2.GLB")?.length ?? 0) },
      { name: "unsupportedFileMessage", params: { calls: 1 }, run: () => consume(unsupportedFileMessage("character.blend").length) },
      { name: "formatFileSize", params: { calls: 1 }, run: () => consume(formatFileSize(25_165_824).length) },
    ]);
    finishWithGrowth("importer/import.names", results, []);
    // A geometry built by hand, so the helpers above are not the only thing this file touches.
    consume(new BufferGeometry().setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3)).getAttribute("position").count);
  });
});
