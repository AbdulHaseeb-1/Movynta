import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import { ExtrudeGesture } from "@/features/objectEditing/ExtrudeGesture";
import type { Viewport } from "@/features/viewport3d";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveExtrude } from "./saveExtrude";
import { setComponentError } from "./workspaceSlice";

/** Edit-mode E extrudes the component selection and saves it with the project. */
export function useExtrude(
  viewport: Viewport | null,
  scene: EditorScene | null,
  disabled: boolean,
  saves: SerialQueue,
): { hint: string } {
  const dispatch = useAppDispatch();
  const { mode, componentKind, componentSelection } = useAppSelector((state) => state.designWorkspace);
  const [hint, setHint] = useState("");
  const current = useRef({ mode, componentKind, componentSelection, disabled });
  useEffect(() => {
    current.current = { mode, componentKind, componentSelection, disabled };
  }, [mode, componentKind, componentSelection, disabled]);
  useEffect(() => {
    if (!viewport || !scene) return undefined;
    const gesture = new ExtrudeGesture(
      viewport,
      scene,
      () => !current.current.disabled && !scene.requiresRecovery,
      () => current.current.mode === "edit",
      () => {
        const selected = current.current.componentSelection;
        if (!selected || selected.ids.length === 0) return null;
        return { objectId: selected.objectId, meshPath: selected.meshPath, kind: current.current.componentKind, ids: selected.ids };
      },
      (commit) => {
        dispatch(setComponentError(""));
        saves.run(() => saveExtrude(scene, commit), (failure) => dispatch(setComponentError(errorMessage(failure))));
      },
      (error) => dispatch(setComponentError(errorMessage(error))),
      setHint,
    );
    return () => gesture.dispose();
  }, [viewport, scene, dispatch, saves]);
  return { hint };
}
