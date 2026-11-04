import { it } from "vitest";
import { CylinderGeometry } from "three";
import { fillHole } from "@/features/meshGeometry/meshFillHole";
import { point, readTopology, topology } from "@/features/meshGeometry/meshTopology";
import { measureCases } from "../../lib/harness";
import { finishWithGrowth } from "../../lib/report";
import { consume } from "../../lib/sink";

it("measures filling a warped boundary, up to the 256-edge command limit", async () => {
  const cases = [32, 128, 256].map((edges) => {
    const geometry = new CylinderGeometry(1, 1, 2, edges, 1, true);
    const mesh = readTopology(geometry);
    const rim = [...topology(mesh).edges].filter(([, incident]) => {
      const half = incident[0];
      return incident.length === 1 && half && point(mesh, half.from).y > 0;
    });
    const vertex = rim[0]?.[1][0]?.from;
    if (vertex === undefined || rim.length !== edges) throw new Error("Invalid benchmark rim");
    point(mesh, vertex).y += 0.1;
    const ids = rim.map(([id]) => id);
    geometry.dispose();
    return {
      name: "triangulate and validate a warped hole",
      params: { edges },
      run: () => consume(fillHole(mesh, ids).selection.length),
    };
  });
  finishWithGrowth("editor/meshRepair", await measureCases(cases), []);
});
