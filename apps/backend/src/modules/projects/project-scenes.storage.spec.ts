import { loadAppConfig } from "../../config/configuration.js";
import { TEST_AUTH_SECRET } from "../../testing/constants.js";
import { DatabaseService } from "../persistence/database.service.js";
import { ProjectScenesService } from "./project-scenes.service.js";
import { ProjectsRepository } from "./projects.repository.js";
import { MAX_PROJECT_ASSET_BYTES } from "./projects.types.js";

it("reclaims abandoned imports only after a new edit commits", () => {
  const database = new DatabaseService(loadAppConfig({ NODE_ENV: "test", AUTH_SECRET: TEST_AUTH_SECRET, DATABASE_URL: ":memory:", AGENTS_ENABLED: "false" }));
  database.open(":memory:");
  try {
    const projectId = "prj_storage";
    new ProjectsRepository(database).insert({ id: projectId, userId: "user", name: "", category: "design", createdAt: "now", updatedAt: "now" });
    const scenes = new ProjectScenesService(database);
    const upload = (objectId: string) => scenes.addImport(projectId, { objectId, name: objectId, format: "glb", content: new Uint8Array([1]) });
    const active = upload("active");
    const abandoned = upload("abandoned");
    const undo = scenes.previewHistory(projectId, "undo");
    scenes.commitHistory(projectId, "undo", undo.version, "undo");
    expect(scenes.asset(projectId, abandoned.assetId).content).toEqual(new Uint8Array([1]));

    // Simulate a full quota without allocating hundreds of megabytes.
    database.db.prepare("UPDATE project_assets SET size = ? WHERE id = ?").run(MAX_PROJECT_ASSET_BYTES, active.assetId);
    expect(() => upload("rejected")).toThrow(/limit/);
    expect(scenes.history(projectId).canRedo).toBe(true);
    expect(scenes.asset(projectId, abandoned.assetId).content).toEqual(new Uint8Array([1]));

    database.db.prepare("UPDATE project_assets SET size = 1 WHERE id = ?").run(active.assetId);
    const replacement = upload("replacement");
    expect(scenes.history(projectId).canRedo).toBe(false);
    expect(() => scenes.asset(projectId, abandoned.assetId)).toThrow();
    expect(scenes.list(projectId)).toEqual([active, replacement]);
  } finally {
    database.close();
  }
});
