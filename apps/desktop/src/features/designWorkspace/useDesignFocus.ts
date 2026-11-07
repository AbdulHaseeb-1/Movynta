import { useEffect } from "react";
import { useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";

/**
 * Keeps the scene's copy of the design mode and Edit-mode picks in step with the workspace, so the assistant can read
 * what the user has selected. Object mode has no picks.
 */
export function useDesignFocus(scene: EditorScene | null): void {
  const { mode, componentKind, componentSelection } = useAppSelector((state) => state.designWorkspace);
  useEffect(() => {
    if (!scene) return;
    const picked = mode === "edit" && componentSelection ? componentSelection : null;
    scene.setDesignFocus({
      mode,
      componentKind: mode === "edit" ? componentKind : null,
      componentSelection: picked
        ? {
            objectId: picked.objectId,
            meshPath: [...picked.meshPath],
            kind: componentKind,
            ids: [...picked.ids],
            modifiersEnabled: false,
          }
        : null,
    });
  }, [scene, mode, componentKind, componentSelection]);
}
