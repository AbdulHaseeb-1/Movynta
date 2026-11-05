import { it } from "vitest";
import { createPolygonMesh } from "@/features/meshGeometry/createPolygonMesh";
import { readTopology, topology } from "@/features/meshGeometry/meshTopology";
import { mergeVertices } from "@/features/meshGeometry/meshMerge";
import { dissolveEdges } from "@/features/meshGeometry/meshDissolve";
import { slideEdges } from "@/features/meshGeometry/meshSlide";
import { loopCut } from "@/features/meshGeometry/meshLoopCut";
import { measureCases, type BenchCase } from "../../lib/harness";
import { finishSuite } from "../../lib/report";
import { consume } from "../../lib/sink";

// Includes complete candidate validation. Excludes source reconstruction, rendering and persistence.
it("measures merge, dissolve, slide and loop cut on explicit quad cages", async () => {
  const sources = [], cases: BenchCase[] = [];
  for (const size of [16, 32]) {
    const vertices: number[][] = [], faces: number[][] = [];
    for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) vertices.push([x, y, 0]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const a = y * (size + 1) + x; faces.push([a, a + 1, a + size + 2, a + size + 1]);
    }
    const source = createPolygonMesh(vertices, faces); sources.push(source);
    const mesh = readTopology(source), graph = topology(mesh);
    const internal = [...graph.edges].filter(([, half]) => half.length === 2).map(([id]) => id);
    const edge = internal[0]; if (!edge) throw new Error("Missing slide edge");
    const rails = edge.split("_").map((vertex) => {
      const p = mesh.positions[Number(vertex)]; if (!p) throw new Error("Missing slide vertex");
      const toward = mesh.positions.findIndex((point) => point.x === p.x + 1 && point.y === p.y);
      return { vertex, toward: String(toward) };
    });
    const params = { faces: mesh.faces.length };
    cases.push(
      { name: "merge boundary vertices", params, run: () => consume(mergeVertices(mesh, ["0", "1"], "center").mesh.faces.length) },
      { name: "dissolve planar region", params, run: () => consume(dissolveEdges(mesh, internal, source).mesh.faces.length) },
      { name: "slide edge", params, run: () => consume(slideEdges(mesh, [edge], rails, 0.25).mesh.positions.length) },
      { name: "two loop cuts", params, run: () => consume(loopCut(mesh, "0_1", 2).mesh.faces.length) },
    );
  }
  try { finishSuite("editor/topologyOperations", await measureCases(cases)); }
  finally { for (const source of sources) source.dispose(); }
});
