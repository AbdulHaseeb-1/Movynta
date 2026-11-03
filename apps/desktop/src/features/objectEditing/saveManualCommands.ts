import type { EditorScene } from "@/features/assistant";
import { recordSceneEdit } from "./sceneEditApi";
import { SAVE_FIRST } from "./applyAndRecord";

/** Validate on an isolated scene, save, then display. Failed preparation never enters history. */
export async function saveManualCommands(
  scene: EditorScene,
  commands: readonly unknown[],
): Promise<void> {
  if (!scene.hasProject) throw new Error(SAVE_FIRST);
  if (scene.requiresRecovery)
    throw new Error("Reload the saved project before editing.");
  const id = `manual_${crypto.randomUUID()}`;
  const revision = scene.currentRevision;
  const prepared = scene.executePrepared(id, revision, commands, "prepare");
  if (prepared.status !== "applied")
    throw new Error(
      "The edit could not be prepared. Check the geometry and parameters.",
    );
  try {
    try {
      await recordSceneEdit(scene.projectId, commands, id);
      scene.executePrepared(id, revision, commands, "commit");
    } catch (error) {
      scene.requireRecovery();
      throw error;
    }
  } finally {
    scene.executePrepared(id, revision, commands, "discard");
  }
}
