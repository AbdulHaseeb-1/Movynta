import { describe, it } from "vitest";
import { BoxGeometry, CylinderGeometry, Matrix4, Mesh, Scene, SphereGeometry } from "three";
import { applyBoolean, ensureManifold } from "@/features/meshGeometry/meshBoolean";
import { bevelSurface } from "@/features/meshGeometry/meshBevel";
import { faceTransformSelection, transformFaces } from "@/features/meshGeometry/meshFaceTransform";
import { FaceTransformPreview } from "@/features/meshGeometry/faceTransformPreview";
import { ExtrudePreviewOverlay } from "@/features/objectEditing/ExtrudePreviewOverlay";
import { writeShadedGeometry } from "@/features/meshGeometry/meshOutput";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { measureCases } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

describe("face modeling", () => {
  it("measures a face transform preview and a rounded through-hole", async () => {
    await ensureManifold();
    const sphere = new SphereGeometry(1, 64, 48);
    const cage = readTopology(sphere);
    const ids = Array.from({ length: 128 }, (_, index) => String(index));
    const selected = faceTransformSelection(cage, ids);
    const matrix = new Matrix4();
    const faceMove = { position: [0, 0.1, 0] };
    const prepared = new FaceTransformPreview(sphere, transformFaces(cage, ids, faceMove, matrix, selected), selected.vertices);
    const overlay = new ExtrudePreviewOverlay(new Scene(), new Mesh(sphere), prepared.result, "face");
    const box = new BoxGeometry(1, 1, 1);
    const cutter = new CylinderGeometry(0.2, 0.2, 2, 24);
    const results = await measureCases([{
      name: "face move with shaded preview",
      params: { triangles: (sphere.index?.count ?? 0) / 3, faces: ids.length },
      run: () => {
        const result = transformFaces(cage, ids, faceMove, matrix, selected);
        const geometry = writeShadedGeometry(sphere, result.mesh);
        consume(geometry.index?.count);
        geometry.dispose();
      },
    }, {
      name: "prepared face move with selection overlay",
      params: { triangles: (sphere.index?.count ?? 0) / 3, faces: ids.length },
      run: () => {
        prepared.update(transformFaces(cage, ids, faceMove, matrix, selected));
        overlay.update();
        consume(prepared.geometry.index?.count);
      },
    }, {
      name: "Boolean through-hole with circular bevel",
      params: { cutterSides: 24, bevelSegments: 3 },
      run: () => {
        const cut = applyBoolean(box, cutter, "difference", matrix);
        const rounded = bevelSurface(readTopology(cut), 0.01, 3, "circular", 30);
        const geometry = writeShadedGeometry(cut, rounded);
        consume(geometry.index?.count);
        geometry.dispose();
        cut.dispose();
      },
    }]);
    finishWithGrowth("editor/faceModeling", results, []);
    overlay.dispose();
    prepared.geometry.dispose();
    sphere.dispose();
    cutter.dispose();
    box.dispose();
  });
});
