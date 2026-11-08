import type { EditorScene } from "@/features/assistant";
import { recordSceneEdit } from "./sceneEditApi";
import { SAVE_FIRST } from "./applyAndRecord";
import { BackendResponseError } from "@/lib/backend";

/** Validate on an isolated scene, save, then display. Failed preparation never enters history. */
export async function saveManualCommands(
  scene: EditorScene,
  commands: readonly unknown[],
  preview?: { show: () => void; dispose: () => void },
): Promise<void> {
  if (!scene.hasProject) throw new Error(SAVE_FIRST);
  if (scene.requiresRecovery) throw new Error("Reload the saved project before editing.");
  const id = `manual_${crypto.randomUUID()}`;
  const revision = scene.currentRevision;
  const prepared = scene.executePrepared(id, revision, commands, "prepare");
  if (prepared.status !== "applied") {
    // Geometry failures carry the reason (for example a non-manifold or inconsistently wound mesh); show it.
    const reason = "message" in prepared && typeof prepared.message === "string" ? prepared.message : "";
    throw new Error(reason || "The edit could not be prepared. Check the geometry and parameters.");
  }
  try {
    try {
      preview?.show();
      await recordSceneEdit(scene.projectId, commands, id);
      preview?.dispose();
      scene.executePrepared(id, revision, commands, "commit");
    } catch (error) {
      // A definite client rejection means the backend did not record the edit. Network, timeout,
      // server and commit failures can be ambiguous and still need recovery.
      if (!(error instanceof BackendResponseError && error.status >= 400 && error.status < 500 && error.status !== 408))
        scene.requireRecovery();
      throw error;
    }
  } finally {
    preview?.dispose();
    scene.executePrepared(id, revision, commands, "discard");
  }
}
