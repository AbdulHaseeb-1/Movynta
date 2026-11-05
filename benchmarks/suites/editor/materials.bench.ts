import { it } from "vitest";
import { buildEditor } from "../../fixtures/scene.fixtures";
import { measureCases } from "../../lib/harness";
import { finishSuite } from "../../lib/report";
import { consume } from "../../lib/sink";

// Includes isolated scene clones and disposal used by material proposal previews; excludes WebGL rendering.
it("measures isolated material previews as scenes grow", async () => {
  const scenes = [10, 100, 400].map((count) => ({ count, built: buildEditor(count) }));
  try {
    finishSuite("editor/materials", await measureCases(scenes.map(({ count, built }) => ({
      name: "material preview", params: { objects: count }, run: () => built.editor.withProposalPreview("material-preview", built.editor.currentRevision, [{
        commandId: "paint", type: "material.set_properties", objectId: "obj_0", slot: 0,
        properties: { color: "#d98855", metalness: 0.8, roughness: 0.25 },
      }], (_scene, candidate) => consume(candidate.currentRevision)),
    }))));
  } finally { for (const { built } of scenes) built.editor.reset(); }
});
