import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { errorMessage } from "@/lib";
import { ComponentSelection } from "./ComponentSelection";
import { setComponentError, setComponentSelection } from "./workspaceSlice";

export function useComponentSelection(
  viewport: Viewport | null,
  scene: EditorScene | null,
  disabled: boolean,
) {
  const dispatch = useAppDispatch();
  const { mode, componentKind } = useAppSelector(
    (state) => state.designWorkspace,
  );
  useEffect(() => {
    if (!viewport || !scene || mode !== "edit" || disabled) return undefined;
    let controller: ComponentSelection | undefined;
    let signature = "";
    const rebuild = () => {
      const next = `${scene.selection}:${scene.currentRevision}`;
      if (next === signature) return;
      signature = next;
      controller?.dispose();
      controller = undefined;
      dispatch(setComponentSelection(null));
      dispatch(setComponentError(""));
      const id = scene.selection;
      const root = id ? scene.getObject(id) : undefined;
      if (!root || !id) return;
      try {
        controller = new ComponentSelection(
          viewport,
          root,
          componentKind,
          (selection) =>
            dispatch(
              setComponentSelection(
                selection
                  ? {
                      objectId: id,
                      meshPath: selection.path,
                      ids: selection.ids,
                    }
                  : null,
              ),
            ),
        );
      } catch (error) {
        dispatch(setComponentError(errorMessage(error)));
      }
    };
    rebuild();
    const unsubscribe = scene.onChange(rebuild);
    return () => {
      unsubscribe();
      controller?.dispose();
      dispatch(setComponentSelection(null));
    };
  }, [viewport, scene, mode, componentKind, disabled, dispatch]);
}
