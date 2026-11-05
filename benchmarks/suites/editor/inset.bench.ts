import { it } from "vitest";
import { createPolygonMesh } from "@/features/meshGeometry/createPolygonMesh";
import { insetFaces } from "@/features/meshGeometry/meshInset";
import { writeExtrudedGeometry } from "@/features/meshGeometry/meshExtrude";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { measureCases } from "../../lib/harness";
import { finishSuite } from "../../lib/report";
import { consume } from "../../lib/sink";

it("measures region and individual inset preview geometry", async () => {
  const cases = [8, 16].flatMap((size) => {
    const stride = size + 1;
    const vertices = Array.from({ length: stride ** 2 }, (_, i) => [i % stride, Math.floor(i / stride), 0]);
    const faces = Array.from({ length: size ** 2 }, (_, i) => {
      const start = i + Math.floor(i / size);
      return [start, start + 1, start + stride + 1, start + stride];
    });
    const source = createPolygonMesh(vertices, faces);
    const cage = readTopology(source);
    const ids = faces.map((_, i) => String(i));
    return ["region", "individual", "relative depth"].map((mode) => ({
      name: `${mode} inset`,
      params: { faces: faces.length },
      run: () => {
        const result = insetFaces(cage, ids, {
          thickness: 0.1,
          individual: mode === "individual",
          ...(mode === "relative depth" ? { depth: 0.1, offsetRelative: true } : {}),
        });
        const preview = writeExtrudedGeometry(source, result);
        consume(preview.index?.count);
        preview.dispose();
      },
      source,
    }));
  });
  try {
    finishSuite("editor/inset", await measureCases(cases));
  } finally {
    for (const source of new Set(cases.map((item) => item.source))) source.dispose();
  }
});
