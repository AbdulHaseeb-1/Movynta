import { it } from "vitest";
import { createPolygonMesh } from "@/features/meshGeometry/createPolygonMesh";
import { measureCases } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

it("measures validation and generation of a large polygon grid", async () => {
  const side = 60;
  const vertices: number[][] = [];
  const faces: number[][] = [];
  for (let y = 0; y <= side; y += 1) for (let x = 0; x <= side; x += 1) vertices.push([x, y, 0]);
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
    const id = y * (side + 1) + x;
    faces.push([id, id + 1, id + side + 2, id + side + 1]);
  }
  const results = await measureCases([{
    name: "validate and build polygon mesh",
    params: { vertices: vertices.length, faces: faces.length },
    run: () => {
      const geometry = createPolygonMesh(vertices, faces);
      consume(geometry.index?.count);
      geometry.dispose();
    },
  }]);
  finishWithGrowth("editor/customMesh", results, []);
});
