import { it } from "vitest";
import { Mesh, SphereGeometry } from "three";
import { inspectMesh } from "@/features/meshGeometry/meshInspection";
import { measureCases } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

it("measures querying a dense mesh by face normal and center", async () => {
  const geometry = new SphereGeometry(1, 96, 80);
  const mesh = new Mesh(geometry);
  const request = {
    objectId: "sphere", meshPath: [], view: "base" as const, offset: 0, limit: 25, includeSamples: false,
    faceQuery: { normal: [0, 1, 0], minDot: 0.75, centerMin: [-1, 0, -1], limit: 1000 },
  };
  inspectMesh(mesh, request);
  const results = await measureCases([{
    name: "query local faces",
    params: { triangles: (geometry.index?.count ?? 0) / 3 },
    run: () => consume(inspectMesh(mesh, request).faceMatches?.total),
  }]);
  finishWithGrowth("editor/faceQuery", results, []);
  geometry.dispose();
});
