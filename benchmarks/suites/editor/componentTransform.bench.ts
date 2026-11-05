import { it } from "vitest";
import { Vector3 } from "three";
import { transformComponents } from "@/features/meshGeometry/meshComponentTransform";
import type { PolygonMesh } from "@/features/meshGeometry/meshTopology";
import { measureCases } from "../../lib/harness";
import { finishSuite } from "../../lib/report";
import { consume } from "../../lib/sink";

// O(vertices + face corners): includes selection resolution and adjoining-face collapse checks.
// Excludes geometry reconstruction and rendering; measures a fixed 64-vertex selection on explicit quad cages.
it("measures base vertex transforms as polygon meshes grow", async () => {
    const cases = [16, 32, 64].map((segments) => {
      const cage: PolygonMesh = { positions: [], faces: [] };
      for (let y = 0; y <= segments; y += 1) for (let x = 0; x <= segments; x += 1) cage.positions.push(new Vector3(x, y, 0));
      for (let y = 0; y < segments; y += 1) for (let x = 0; x < segments; x += 1) {
        const a = y * (segments + 1) + x;
        cage.faces.push([a, a + 1, a + segments + 2, a + segments + 1]);
      }
      const ids = Array.from({ length: 64 }, (_, i) => String(i));
      return { name: "transform vertices", params: { faces: cage.faces.length }, run: () => {
        const result = transformComponents(cage, "vertex", ids, { position: [0, 0, 0.01] });
        consume(result.mesh.positions.length);
      } };
    });
    finishSuite("editor/componentTransform", await measureCases(cases));
});
