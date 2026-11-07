import type { EditorScene } from "@/features/assistant";
import type { ConfirmedPreview, ExtrudeCommit } from "@/features/objectEditing/ExtrudeGesture";
import { saveCageEdit } from "./saveCageEdit";

/** Saves one previewed extrude. Its ids and offset only mean something on the mesh that was previewed. */
export function saveExtrude(scene: EditorScene, commit: ExtrudeCommit, preview?: ConfirmedPreview): Promise<void> {
  return saveCageEdit(
    scene,
    {
      revision: commit.revision,
      objectId: commit.objectId,
      meshPath: commit.meshPath,
      selection: commit.selection,
      edit: {
        type: "geometry.extrude",
        kind: commit.kind,
        ids: commit.ids,
        ...commit.shape,
        ...(commit.normalDistance === undefined
          ? { offset: commit.offset }
          : { normalDistance: commit.normalDistance }),
        ...(commit.normalMode ? { normalMode: commit.normalMode } : {}),
        ...(commit.closeOpenSurface ? { closeOpenSurface: true } : {}),
      },
    },
    preview,
  );
}
