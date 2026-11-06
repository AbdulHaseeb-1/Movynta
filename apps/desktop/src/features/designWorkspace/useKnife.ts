import { useCallback, useEffect, useRef, useState } from "react";
import { Mesh, type Object3D } from "three";
import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { errorMessage, type SerialQueue } from "@/lib";
import { KnifeGesture, type KnifeTarget } from "./KnifeGesture";
import { saveCageEdit } from "./saveCageEdit";
import {
  setComponentError,
  setKnifeActive,
  setKnifeSettings,
} from "./workspaceSlice";

function firstMesh(node: Object3D, path: number[] = []): number[] | null {
  if (!node.visible) return null;
  if (node instanceof Mesh) return path;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child) {
      const found = firstMesh(child, [...path, i]);
      if (found) return found;
    }
  }
  return null;
}
export function useKnife(
  viewport: Viewport | null,
  scene: EditorScene | null,
  disabled: boolean,
  saves: SerialQueue,
) {
  const dispatch = useAppDispatch(),
    workspace = useAppSelector((state) => state.designWorkspace);
  const current = useRef({ workspace, disabled });
  useEffect(() => {
    current.current = { workspace, disabled };
  }, [workspace, disabled]);
  const [hint, setHint] = useState("");
  const gesture = useRef<KnifeGesture | null>(null),
    saving = useRef(false);
  const start = useCallback(
    (onlySelected = false) => gesture.current?.start(onlySelected),
    [],
  );
  useEffect(() => {
    if (!viewport || !scene) return undefined;
    const target = (): KnifeTarget | null => {
      const choice = current.current.workspace.componentSelection;
      const objectId = scene.selection;
      if (!objectId) return null;
      const root = scene.getObject(objectId);
      if (!root) return null;
      const meshPath =
        choice?.objectId === objectId ? choice.meshPath : firstMesh(root);
      if (!meshPath) return null;
      return {
        objectId,
        meshPath: [...meshPath],
        selectedFaces:
          choice?.objectId === objectId &&
          current.current.workspace.componentKind === "face"
            ? choice.ids.map(Number)
            : [],
      };
    };
    const instance = new KnifeGesture(
      viewport,
      scene,
      () =>
        current.current.workspace.mode === "edit" &&
        !current.current.disabled &&
        !scene.requiresRecovery &&
        !saving.current,
      target,
      (commit) => {
        saving.current = true;
        dispatch(setComponentError(""));
        saves.run(
          async () => {
            try {
              await saveCageEdit(scene, {
                ...commit,
                selection: [],
                edit: {
                  type: "geometry.knife_path",
                  segments: commit.segments,
                },
              });
            } finally {
              saving.current = false;
            }
          },
          (error) => dispatch(setComponentError(errorMessage(error))),
        );
      },
      (message) => dispatch(setComponentError(message)),
      setHint,
      (active) => dispatch(setKnifeActive(active)),
      () => current.current.workspace.knifeSettings,
      (settings) => dispatch(setKnifeSettings(settings)),
    );
    gesture.current = instance;
    return () => {
      gesture.current = null;
      instance.dispose();
    };
  }, [viewport, scene, saves, dispatch]);
  return { hint, start, active: workspace.knifeActive };
}
