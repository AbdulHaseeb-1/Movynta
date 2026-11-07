import { Scene } from "three";
import { z } from "zod";
import { EditorScene } from "@/features/assistant/EditorScene";
import { loadSavedModel } from "@/features/importer";
import { projectSceneSchema } from "@/features/projects/projectTypes";
import { backendRequest } from "@/lib/backend";

/** Load the complete target before committing, so missing assets leave both scene and history intact. */
export async function changeSceneHistory(editor: EditorScene, direction: "undo" | "redo"): Promise<void> {
  const path = `/projects/${editor.projectId}/scene/history`;
  const preview = await backendRequest(
    `${path}/preview`,
    projectSceneSchema.extend({ version: z.number().int() }),
    "POST",
    { direction },
  );
  const candidate = new EditorScene(new Scene(), editor.projectId);
  const revision = editor.currentRevision;
  try {
    await candidate.restore(preview.steps, (step) => loadSavedModel(editor.projectId, step));
    if (editor.currentRevision !== revision) throw new Error("Scene changed while loading history; try again");
    const body = { direction, version: preview.version, operationId: `hist_${crypto.randomUUID()}` };
    try {
      await backendRequest(`${path}/commit`, z.object({ committed: z.boolean() }), "POST", body);
    } catch {
      // A lost HTTP response is ambiguous: retry the exact operation id, never another undo.
      try {
        await backendRequest(`${path}/commit`, z.object({ committed: z.boolean() }), "POST", body);
      } catch (error) {
        editor.requireRecovery();
        throw error;
      }
    }
    editor.replaceFrom(candidate);
  } finally {
    candidate.reset();
  }
}

/** Reloads the project's saved scene into the editor after a save failed or was interrupted. With onlyIfNeeded it does nothing unless a recovery is needed. The editor refuses edits until the reload succeeds. */
export async function recoverSavedScene(editor: EditorScene, onlyIfNeeded = false): Promise<void> {
  let saved: z.infer<typeof projectSceneSchema> & { recoveryRequired?: boolean | undefined };
  try {
    saved = await backendRequest(
      `/projects/${editor.projectId}/scene`,
      projectSceneSchema.extend({ recoveryRequired: z.boolean().optional() }),
    );
  } catch (error) {
    editor.requireRecovery();
    throw error;
  }
  if (onlyIfNeeded && !saved.recoveryRequired && !editor.requiresRecovery) return;
  editor.requireRecovery();
  const candidate = new EditorScene(new Scene(), editor.projectId);
  try {
    await candidate.restore(saved.steps, (step) => loadSavedModel(editor.projectId, step));
    editor.discardPrepared();
    editor.replaceFrom(candidate);
  } finally {
    candidate.reset();
  }
}
