import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { errorMessage } from "@/lib";
import { meshAtPath } from "@/features/meshGeometry";
import { cageKey, readTopology } from "@/features/meshGeometry/meshTopology";
import { ComponentSelection } from "./ComponentSelection";
import { convertComponentSelection } from "./convertComponentSelection";
import { loadComponentSelection, saveComponentSelection } from "./selectionStorage";
import { takeComponentSelection } from "./componentRestore";
import { setComponentError, setComponentSelection } from "./workspaceSlice";
import { watchEditObjectSelection } from "./watchEditObjectSelection";

export function useComponentSelection(
  viewport: Viewport | null,
  scene: EditorScene | null,
  disabled: boolean,
) {
  const dispatch = useAppDispatch();
  const { mode, componentKind } = useAppSelector(
    (state) => state.designWorkspace,
  );
  const remembered = useRef<{ scene: EditorScene; objectId: string; kind: typeof componentKind; path: number[]; ids: string[]; key: string } | null>(null);
  const keys = useRef(new WeakMap<ReturnType<typeof readTopology>, string>());
  const loadedScene = useRef<EditorScene | null>(null);
  useEffect(() => {
    if (!viewport || !scene || mode !== "edit" || disabled) return undefined;
    let restoreObject: string | null = null;
    if (loadedScene.current !== scene) {
      loadedScene.current = scene;
      const stored = scene.hasProject ? loadComponentSelection(scene.projectId) : null;
      remembered.current = stored ? { ...stored, scene } : null;
      restoreObject = stored?.objectId ?? null;
    }
    let controller: ComponentSelection | undefined;
    const stopObjectSelection = watchEditObjectSelection(viewport, scene);
    const keyOf = (cage: ReturnType<typeof readTopology>) => {
      const known = keys.current.get(cage);
      if (known) return known;
      const key = cageKey(cage);
      keys.current.set(cage, key);
      return key;
    };
    let signature = "";
    const rebuild = () => {
      if (scene.selection) restoreObject = null;
      if (!scene.selection && restoreObject && scene.getObject(restoreObject)) {
        const id = restoreObject;
        restoreObject = null;
        scene.select(id);
        return;
      }
      const next = `${scene.selection}:${scene.currentRevision}`;
      if (next === signature) return;
      signature = next;
      controller?.dispose();
      controller = undefined;
      dispatch(setComponentSelection(null));
      const id = scene.selection;
      const root = id ? scene.getObject(id) : undefined;
      if (!root || !id) return;
      try {
        controller = new ComponentSelection(
          viewport,
          root,
          componentKind,
          (selection) => {
            if (selection) {
              const mesh = meshAtPath(root, selection.path);
              remembered.current = { scene, objectId: id, kind: componentKind, path: selection.path, ids: selection.ids, key: keyOf(readTopology(mesh.geometry)) };
              if (scene.hasProject) saveComponentSelection(scene.projectId, {
                objectId: id, kind: componentKind, path: selection.path, ids: selection.ids, key: remembered.current.key,
              });
            } else {
              remembered.current = null;
              if (scene.hasProject) saveComponentSelection(scene.projectId, null);
            }
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
            );
          },
        );
        const queued = takeComponentSelection(scene, id);
        if (queued) controller.select(queued.meshPath, queued.ids);
        else {
          const previous = remembered.current;
          if (previous?.scene === scene && previous.objectId === id) {
            const mesh = meshAtPath(root, previous.path);
            const cage = readTopology(mesh.geometry);
            if (keyOf(cage) === previous.key) {
              const ids = convertComponentSelection(cage, previous.kind, componentKind, previous.ids);
              if (ids.length) controller.select(previous.path, ids);
              else remembered.current = null;
            }
            else remembered.current = null;
          }
        }
      } catch (error) {
        dispatch(setComponentError(errorMessage(error)));
      }
    };
    rebuild();
    const unsubscribe = scene.onChange(rebuild);
    return () => {
      unsubscribe();
      controller?.dispose();
      stopObjectSelection();
    };
  }, [viewport, scene, mode, componentKind, disabled, dispatch]);
}
