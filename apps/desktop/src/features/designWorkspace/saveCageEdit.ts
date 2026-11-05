import type { EditorScene } from "@/features/assistant";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import type { ExtrudeKind } from "@/features/meshGeometry/meshExtrude";
import type { FaceTransform } from "@/features/meshGeometry/meshFaceTransform";
import type { InsetOptions } from "@/features/meshGeometry/meshInset";
import { queueComponentSelection } from "./componentRestore";
import type { ConfirmedPreview } from "@/features/objectEditing/ExtrudeGesture";

/** The change a component edit makes to the base cage of one mesh part. */
export type CageEdit =
  | { type: "geometry.merge_vertices"; ids: string[]; mode: "center" | "first" | "last" }
  | { type: "geometry.dissolve_edges"; ids: string[] }
  | { type: "geometry.fill_hole"; ids: string[] }
  | { type: "geometry.extrude"; kind: ExtrudeKind; ids: string[]; offset?: [number, number, number]; normalDistance?: number; normalMode?: "vertex" | "individual"; closeOpenSurface?: true; capScale?: number; twistDegrees?: number; capRotationDegrees?: number[] }
  | { type: "geometry.transform_faces"; ids: string[]; space: "world"; transform: FaceTransform }
  | { type: "geometry.subdivide_faces"; ids: string[] }
  | { type: "geometry.bevel_edges"; ids: string[]; width: number; segments: number; profile: "chamfer" | "round" | "circular" }
  | ({ type: "geometry.inset_faces"; ids: string[] } & InsetOptions);

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
export async function saveCageEdit(scene: EditorScene, save: CageEditSave, preview?: ConfirmedPreview): Promise<void> {
  if (scene.currentRevision !== save.revision)
    throw new Error("The mesh changed before this edit was saved. Select the components and try again.");
  queueComponentSelection({ scene, objectId: save.objectId, meshPath: save.meshPath, ids: save.selection });
  try {
    await saveManualCommands(scene, [{
      commandId: `edit_${crypto.randomUUID()}`,
      objectId: save.objectId,
      meshPath: save.meshPath,
      ...save.edit,
    }], preview);
  } finally {
    // The rebuild that follows a commit has already taken the selection. Anything left is stale.
    queueComponentSelection(null);
  }
}
