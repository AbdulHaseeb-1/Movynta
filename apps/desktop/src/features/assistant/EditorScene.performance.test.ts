import { expect, it } from "vitest";
import { Scene } from "three";
import { EditorScene } from "./EditorScene";

it("benchmarks scene snapshots and atomic updates at the 2,000-object limit", () => {
  const editor = new EditorScene(new Scene(), "benchmark");
  for (let batch = 0; batch < 40; batch += 1) {
    const commands = Array.from({ length: 50 }, (_, index) => ({
      commandId: `cmd-${batch}-${index}`,
      type: "scene.create_object",
      objectId: `object-${batch}-${index}`,
      name: "Object",
    }));
    editor.execute(`proposal-${batch}`, batch, commands);
  }
  const samples = 100;
  let start = performance.now();
  for (let index = 0; index < samples; index += 1) editor.context();
  const snapshotMs = (performance.now() - start) / samples;
  start = performance.now();
  for (let index = 0; index < samples; index += 1)
    editor.execute(`update-${index}`, 40 + index, [
      {
        commandId: "move",
        type: "scene.transform_object",
        objectId: "object-0-0",
        transform: { position: [index, 0, 0] },
      },
    ]);
  const updateMs = (performance.now() - start) / samples;
  expect(editor.context().objects).toHaveLength(2000);
  // eslint-disable-next-line no-console -- The benchmark result is an intentional test artifact.
  console.info(
    JSON.stringify({ objects: 2000, samples, snapshotMs, updateMs }),
  );
});
