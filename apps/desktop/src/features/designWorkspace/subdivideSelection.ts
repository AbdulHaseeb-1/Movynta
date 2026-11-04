import type { EditorScene } from "@/features/assistant";
import type { SerialQueue } from "@/lib";
import { meshAtPath } from "@/features/meshGeometry";
import { subdivideFaces } from "@/features/meshGeometry/meshSubdivideFaces";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { saveCageEdit } from "./saveCageEdit";

/** The components the user has selected in Edit mode. */
export interface ComponentChoice {
  objectId: string;
  meshPath: number[];
  ids: string[];
}

/**
 * Edit-mode Subdivide: splits only the selected faces of the base cage. The new quads become the selection, so the
 * user can keep working on what was just subdivided. Anything that cannot be subdivided is reported before a save.
 */
export function subdivideSelectedFaces(
  scene: EditorScene,
  choice: ComponentChoice,
  saves: SerialQueue,
  onError: (failure: unknown) => void,
): void {
  try {
    const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
    const revision = scene.currentRevision;
    const { selection } = subdivideFaces(readTopology(mesh.geometry), choice.ids);
    saves.run(() => saveCageEdit(scene, {
      revision,
      objectId: choice.objectId,
      meshPath: choice.meshPath,
      selection,
      edit: { type: "geometry.subdivide_faces", ids: [...choice.ids] },
    }), onError);
  } catch (error) {
    onError(error);
  }
}
