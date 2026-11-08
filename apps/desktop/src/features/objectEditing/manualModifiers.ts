import type { MeshModifierSpec, MeshPath } from "@movynta/editor-protocol";
import type { EditorScene } from "@/features/assistant";
import { saveManualCommands } from "./saveManualCommands";

/** Saves a mesh's modifier stack as one undoable edit. */
export function saveModifiers(
  scene: EditorScene,
  objectId: string,
  meshPath: MeshPath,
  modifiers: MeshModifierSpec[],
): Promise<void> {
  return saveManualCommands(scene, [
    {
      commandId: `modifier_${crypto.randomUUID()}`,
      type: "geometry.set_modifiers",
      objectId,
      meshPath,
      modifiers,
    },
  ]);
}
