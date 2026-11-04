import { describe, it } from "vitest";
import { Mesh, Scene, SphereGeometry, Vector3 } from "three";
import { extrudeAlongRegionNormal, extrudeRegion, writeExtrudedGeometry } from "@/features/meshGeometry/meshExtrude";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { ExtrudeFacePreview } from "@/features/meshGeometry/extrudeFacePreview";
import { FaceTransformPreview } from "@/features/meshGeometry/faceTransformPreview";
import { ExtrudePreviewOverlay } from "@/features/objectEditing/ExtrudePreviewOverlay";
import { measureCases } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

describe("extrude preview", () => {
  it("measures a complete face preview update", async () => {
    const source = new SphereGeometry(1, 80, 75);
    const cage = readTopology(source);
    const ids = Array.from({ length: 250 }, (_, index) => String(index));
    const offset = new Vector3(0.23, 0.41, 0.67);
    const preview = new ExtrudeFacePreview(source, extrudeRegion(cage, "face", ids, offset), offset);
    const overlay = new ExtrudePreviewOverlay(new Scene(), new Mesh(source), preview.result, "face");
    const shape = { capScale: 0.8, twistDegrees: 10 };
    const shaped = extrudeRegion(cage, "face", ids, offset, shape);
    const vertices = new Set(shaped.selection.flatMap((id) => shaped.mesh.faces[Number(id)] ?? []));
    const shapedPreview = new FaceTransformPreview(source, shaped, vertices);
    const normalShape = { normalMode: "vertex" as const };
    const normal = extrudeAlongRegionNormal(cage, ids, 0.1, normalShape);
    const normalVertices = new Set(normal.selection.flatMap((id) => normal.mesh.faces[Number(id)] ?? []));
    const normalPreview = new FaceTransformPreview(source, normal, normalVertices);
    const results = await measureCases([{
      name: "rebuild extrusion preview", params: { triangles: (source.index?.count ?? 0) / 3, faces: ids.length },
      run: () => { const result = extrudeRegion(cage, "face", ids, offset); const geometry = writeExtrudedGeometry(source, result); consume(geometry.getAttribute("position").count); geometry.dispose(); },
    }, {
      name: "update prepared face preview", params: { triangles: (source.index?.count ?? 0) / 3, faces: ids.length },
      run: () => { preview.update(offset); consume(preview.geometry.getAttribute("position").count); },
    }, {
      name: "update face preview and overlay", params: { triangles: (source.index?.count ?? 0) / 3, faces: ids.length },
      run: () => { preview.update(offset); overlay.update(); consume(preview.geometry.getAttribute("position").count); },
    }, {
      name: "update shaped extrusion preview", params: { triangles: (source.index?.count ?? 0) / 3, faces: ids.length },
      run: () => { shapedPreview.update(extrudeRegion(cage, "face", ids, offset, shape)); consume(shapedPreview.geometry.getAttribute("position").count); },
    }, {
      name: "update normal extrusion preview", params: { triangles: (source.index?.count ?? 0) / 3, faces: ids.length },
      run: () => { normalPreview.update(extrudeAlongRegionNormal(cage, ids, 0.1, normalShape)); consume(normalPreview.geometry.getAttribute("position").count); },
    }]);
    finishWithGrowth("editor/extrudePreview", results, []);
    overlay.dispose(); preview.geometry.dispose(); shapedPreview.geometry.dispose(); normalPreview.geometry.dispose(); source.dispose();
  });
});
