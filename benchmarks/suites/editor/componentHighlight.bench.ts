/*
 * BENCH: Edit-mode face highlight construction, excluding GPU upload.
 * TIER: HIGH; INPUTS: ~12k triangles and 1, 25 or 250 selected faces.
 * Measures repeated interactive highlight updates on a curved mesh.
 */
import { describe, it } from "vitest";
import { SphereGeometry } from "three";
import { componentGeometry, faceHighlightPositions } from "@/features/designWorkspace/componentGeometry";
import { measureCases } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

describe("component highlights", () => {
  it("builds highlights for increasingly large face selections", async () => {
    const source = new SphereGeometry(1, 80, 75); const data = componentGeometry(source);
    const cases = [1, 25, 250].map((faces) => { const ids = Array.from({ length: faces }, (_, i) => String(i)); return { name: "face highlight", params: { triangles: data.triangleFaces.length, faces }, run: () => consume(faceHighlightPositions(data, ids).length) }; });
    const results = await measureCases(cases); finishWithGrowth("editor/componentHighlight", results, []);
    data.picking.dispose(); source.dispose();
  });
  it("keeps fixed-size selection work stable as mesh density grows", async () => {
    const shapes = [new SphereGeometry(1, 20, 20), new SphereGeometry(1, 40, 40), new SphereGeometry(1, 80, 75)];
    const geometries = shapes.map(componentGeometry);
    const ids = Array.from({ length: 25 }, (_, i) => String(i));
    const results = await measureCases(geometries.map((data) => ({ name: "face highlight at fixed selection", params: { triangles: data.triangleFaces.length, faces: ids.length }, run: () => consume(faceHighlightPositions(data, ids).length) })));
    finishWithGrowth("editor/componentHighlight.density", results, [{ key: "triangles", declared: 0, tolerance: 0.5, label: "fixed selection" }]);
    geometries.forEach((data) => data.picking.dispose()); shapes.forEach((shape) => shape.dispose());
  });
  it("prepares picking geometry when switching selection modes", async () => {
    const shapes = [new SphereGeometry(1, 20, 20), new SphereGeometry(1, 40, 40), new SphereGeometry(1, 80, 75)];
    const results = await measureCases(shapes.map((shape) => ({ name: "component geometry preparation (warm)", params: { triangles: (shape.index?.count ?? 0) / 3 }, run: () => { const result = componentGeometry(shape); consume(result.triangleFaces.length); result.picking.dispose(); } })));
    finishWithGrowth("editor/componentPreparation", results, []); shapes.forEach((shape) => shape.dispose());
  });
});
