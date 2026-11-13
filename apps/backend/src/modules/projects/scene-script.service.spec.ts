import { describe, expect, it } from "@jest/globals";
import { SceneScriptService } from "./scene-script.service.js";

const scene = {
  projectId: "prj_test",
  revision: 3,
  activeSceneName: null,
  selectedObjectIds: [],
  objects: [],
};

describe("SceneScriptService", () => {
  const service = new SceneScriptService();
  it("generates commands from the supplied scene without applying them", async () => {
    const result = await service.generate("prj_test", {
      scene,
      source:
        "return [{commandId: 'c', type: 'geometry.create_primitive', objectId: 'box', primitive: 'box', size: scene.revision}];",
    });
    expect(result.revision).toBe(3);
    expect(result.commands[0]).toMatchObject({ objectId: "box", size: 3 });
  });
  it("rejects mismatched projects, invalid commands and script errors", async () => {
    await expect(
      service.generate("prj_other", { scene, source: "return [];" }),
    ).rejects.toThrow("Invalid script or scene snapshot");
    await expect(
      service.generate("prj_test", {
        scene,
        source: "return [{type: 'unknown'}];",
      }),
    ).rejects.toThrow();
    await expect(
      service.generate("prj_test", {
        scene,
        source: "throw new Error('example failure');",
      }),
    ).rejects.toThrow("example failure");
  });
});
