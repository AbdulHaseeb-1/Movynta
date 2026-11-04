import type { EditorScene } from "@/features/assistant";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import type { ExtrudeKind } from "@/features/meshGeometry/meshExtrude";
import { queueComponentSelection } from "./componentRestore";

/** The change a component edit makes to the base cage of one mesh part. */
export type CageEdit =
  | { type: "geometry.extrude"; kind: ExtrudeKind; ids: string[]; offset: [number, number, number] }
  | { type: "geometry.subdivide_faces"; ids: string[] };

/** One previewed or chosen component edit. `selection` is what stays selected once the edit has applied. */
export interface CageEditSave {
  /** The scene revision the ids were chosen on. The ids only mean something on that revision. */
  revision: number;
  objectId: string;
  meshPath: number[];
  selection: string[];
  edit: CageEdit;
}

/**
 * Saves one component edit. A scene that has moved on since the edit was chosen is refused rather than edited from
 * the wrong state. The selection is restored only for the rebuild this save causes, and cleared once the save settles.
 */
export async function saveCageEdit(scene: EditorScene, save: CageEditSave): Promise<void> {
  if (scene.currentRevision !== save.revision)
    throw new Error("The mesh changed before this edit was saved. Select the components and try again.");
  queueComponentSelection({ scene, objectId: save.objectId, meshPath: save.meshPath, ids: save.selection });
  try {
    await saveManualCommands(scene, [{
      commandId: `edit_${crypto.randomUUID()}`,
      objectId: save.objectId,
      meshPath: save.meshPath,
      ...save.edit,
    }]);
  } finally {
    // The rebuild that follows a commit has already taken the selection. Anything left is stale.
    queueComponentSelection(null);
  }
}
