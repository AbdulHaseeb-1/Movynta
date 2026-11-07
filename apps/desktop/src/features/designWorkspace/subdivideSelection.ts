import type { EditorScene } from "@/features/assistant";
import type { SerialQueue } from "@/lib";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
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
  /** Called once the subdivision has been saved or has failed, or at once when it cannot be started. */
  onSettled: () => void = () => undefined,
): void {
  try {
    const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
    // The picks name the display mesh while a modifier is enabled, so they cannot be subdivided until it is off.
    if ((modifierStack(mesh)?.modifiers ?? []).some((modifier) => modifier.enabled))
      throw new Error("Disable modifiers before editing components, so the selection matches the base mesh");
    const revision = scene.currentRevision;
    const { selection } = subdivideFaces(readTopology(mesh.geometry), choice.ids);
    saves.run(async () => {
      try {
        await saveCageEdit(scene, {
          revision,
          objectId: choice.objectId,
          meshPath: choice.meshPath,
          selection,
          edit: { type: "geometry.subdivide_faces", ids: [...choice.ids] },
        });
      } finally {
        onSettled();
      }
    }, onError);
  } catch (error) {
    onError(error);
    onSettled();
  }
}
