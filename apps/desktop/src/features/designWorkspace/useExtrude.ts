import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import { ExtrudeGesture, type FaceTool } from "@/features/objectEditing/ExtrudeGesture";
import type { Viewport } from "@/features/viewport3d";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveExtrude } from "./saveExtrude";
import { saveCageEdit } from "./saveCageEdit";
import { setComponentError } from "./workspaceSlice";

/** Edit-mode E extrudes the component selection and saves it with the project. */
export function useExtrude(
  viewport: Viewport | null,
  scene: EditorScene | null,
  disabled: boolean,
  saves: SerialQueue,
): { hint: string; start: (tool: FaceTool) => void } {
  const dispatch = useAppDispatch();
  const { mode, componentKind, componentSelection } = useAppSelector((state) => state.designWorkspace);
  const [hint, setHint] = useState("");
  const gestureRef = useRef<ExtrudeGesture | null>(null);
  const start = useCallback((tool: FaceTool) => gestureRef.current?.start(tool), []);
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
      (commit, preview) => {
        dispatch(setComponentError(""));
        saves.run(async () => { try { await saveExtrude(scene, commit, preview); } finally { preview?.dispose(); } }, (failure) => dispatch(setComponentError(errorMessage(failure))));
      },
      (error) => dispatch(setComponentError(errorMessage(error))),
      setHint,
      (commit, preview) => {
        dispatch(setComponentError(""));
        saves.run(async () => { try { await saveCageEdit(scene, {
          ...commit,
          edit: { type: "geometry.transform_faces", ids: commit.ids, space: "world", transform: commit.transform },
        }, preview); } finally { preview?.dispose(); } }, (failure) => dispatch(setComponentError(errorMessage(failure))));
      },
      (commit, preview) => {
        dispatch(setComponentError(""));
        saves.run(async () => { try { await saveCageEdit(scene, {
          ...commit,
          edit: { type: "geometry.inset_faces", ids: commit.ids, ...commit.options },
        }, preview); } finally { preview?.dispose(); } }, (failure) => dispatch(setComponentError(errorMessage(failure))));
      },
      (commit, preview) => {
        dispatch(setComponentError(""));
        saves.run(async () => { try { await saveCageEdit(scene, {
          ...commit,
          edit: { type: "geometry.bevel_edges", ids: commit.ids, width: commit.width, segments: commit.segments, profile: "circular" },
        }, preview); } finally { preview?.dispose(); } }, (failure) => dispatch(setComponentError(errorMessage(failure))));
      },
      true,
    );
    gestureRef.current = gesture;
    return () => {
      gestureRef.current = null;
      gesture.dispose();
    };
  }, [viewport, scene, dispatch, saves]);
  return { hint, start };
}
