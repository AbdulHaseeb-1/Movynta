import { it } from "vitest";
import { Mesh, Scene, SphereGeometry } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import { measureCases } from "../../lib/harness";
import { finishSuite } from "../../lib/report";
import { consume } from "../../lib/sink";

it("measures evaluated dimensions and closest-surface clearance", async () => {
  const geometry = new SphereGeometry(1, 32, 16);
  const scene = new EditorScene(new Scene(), "p");
  const first = new Mesh(geometry), second = new Mesh(geometry);
  second.position.x = 3;
  scene.importObject("a", first); scene.importObject("b", second);
  try {
    const results = await measureCases(["dimensions", "clearance"].map((kind) => ({
      name: kind,
      params: { triangles: (geometry.index?.count ?? 0) / 3 },
      run: () => {
        const result = kind === "dimensions"
          ? scene.measure({ kind: "dimensions", target: { objectId: "a" } })
          : scene.measure({ kind: "clearance", first: { objectId: "a" }, second: { objectId: "b" }, method: "surface" });
        if (result.status !== "ok") throw new Error(result.message);
        consume(result.data.kind === "dimensions" ? result.data.size[0] : result.data.kind === "clearance" ? result.data.distance : 0);
      },
    })));
    finishSuite("editor/measurements", results);
  } finally { geometry.dispose(); }
});
