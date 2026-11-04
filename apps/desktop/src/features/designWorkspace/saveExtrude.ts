import type { EditorScene } from "@/features/assistant";
import type { ExtrudeCommit } from "@/features/objectEditing/ExtrudeGesture";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import { queueComponentSelection } from "./componentRestore";

/**
 * Saves one previewed extrude. Its ids and offset only mean something on the mesh that was previewed, so a scene
 * that has moved on since then is refused rather than extruded from the wrong state.
 */
export async function saveExtrude(scene: EditorScene, commit: ExtrudeCommit): Promise<void> {
  if (scene.currentRevision !== commit.revision)
    throw new Error("The mesh changed before this extrude was saved. Select the components and extrude again.");
  queueComponentSelection({ scene, objectId: commit.objectId, meshPath: commit.meshPath, ids: commit.selection });
  try {
    await saveManualCommands(scene, [{
      commandId: `extrude_${crypto.randomUUID()}`,
      type: "geometry.extrude",
      objectId: commit.objectId,
      meshPath: commit.meshPath,
      kind: commit.kind,
      ids: commit.ids,
      offset: commit.offset,
    }]);
  } finally {
    // The rebuild that follows a commit has already taken the selection. Anything left is stale.
    queueComponentSelection(null);
  }
}
