import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "@/app/hooks";
import type { EditorScene, ObjectTransform } from "@/features/assistant";
import type { Viewport, ViewportTool } from "@/features/viewport3d";
import { errorMessage, type SerialQueue } from "@/lib";
import { applyAndRecord, SAVE_FIRST } from "./applyAndRecord";
import { inBatches } from "./batches";
import { ObjectGizmo, type ObjectChange } from "./ObjectGizmo";
import { recordSceneEdit } from "./sceneEditApi";
import { SelectionTools } from "./SelectionTools";
import { changeSceneHistory } from "./sceneHistory";

/** The active object, as the panel shows it, and how many objects are selected with it. */
export interface SelectedObject {
  id: string;
  name: string;
  transform: ObjectTransform;
  /** Every selected object, the active one included; the handles and delete act on all of them. */
  count: number;
}

interface ObjectEditingOptions {
  viewport: Viewport | null;
  scene: EditorScene | null;
  /** True while the assistant is working: objects can be selected but not changed. */
  disabled: boolean;
  /** Where saves wait their turn; shared with other editors of the scene so the saved order is the real one. */
  saves: SerialQueue;
}

export interface ObjectEditing {
  selected: SelectedObject | null;
  /** Why the last change could not be saved, until it is dismissed. */
  error: string;
  dismissError: () => void;
  /** Changes some parts of the selected object's transform, for example from typed values. */
  updateTransform: (patch: Partial<ObjectTransform>) => void;
  deselect: () => void;
  /** Deletes every selected object immediately. */
  requestDelete: () => void;
}

type SceneChange =
  | { kind: "transform"; changes: ObjectChange[] }
  | { kind: "delete"; ids: readonly string[] };

function describe(scene: EditorScene): SelectedObject | null {
  const id = scene.selection;
  const transform = id ? scene.transformOf(id) : undefined;
  if (!id || !transform) return null;
  return { id, name: scene.getObject(id)?.name || id, transform, count: scene.selectedIds.length };
}

/**
 * Applies a move and saves it with the project; the objects go back if it cannot be saved. A change to
 * more objects than one batch holds is saved batch by batch, each kept or taken back on its own.
 */
async function applyTransform(
  scene: EditorScene,
  change: Extract<SceneChange, { kind: "transform" }>,
): Promise<void> {
  const actionId = `edit_${crypto.randomUUID()}`;
  for (const batch of inBatches(change.changes)) {
    // Batches are saved one after another, in order.
    // eslint-disable-next-line no-await-in-loop
    await applyAndRecord(scene, {
      apply: () => scene.applyUserTransforms(batch.map(({ id, after }) => ({ id, transform: after }))),
      revert: () => void scene.applyUserTransforms(batch.map(({ id, before }) => ({ id, transform: before }))),
    }, (projectId, commands) => recordSceneEdit(projectId, commands, actionId));
  }
}

/**
 * Deletes objects and everything attached below them. A deletion cannot be taken back in the scene
 * once its parts are freed, so it is saved first and applied only if saving worked.
 */
async function applyDelete(
  scene: EditorScene,
  change: Extract<SceneChange, { kind: "delete" }>,
): Promise<void> {
  if (!scene.hasProject) throw new Error(SAVE_FIRST);
  const actionId = `delete_${crypto.randomUUID()}`;
  // The deepest parts go first, and a batch never separates a part from the one it hangs from.
  for (const commands of inBatches(scene.deleteCommandsFor(change.ids))) {
    // Batches are saved one after another, in order.
    // eslint-disable-next-line no-await-in-loop
    await recordSceneEdit(scene.projectId, commands, actionId);
    if (!scene.applyUserEdit(commands))
      throw new Error("The objects were removed from the project but could not be removed here. Reopen the project.");
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Selecting objects and moving, rotating, scaling and deleting them. Owns the {@link ObjectGizmo} for
 * the viewport and saves every finished change. Changes are saved one at a time, in the order they were
 * made, so the saved history matches what happened.
 */
export function useObjectEditing({
  viewport,
  scene,
  disabled,
  saves,
}: ObjectEditingOptions): ObjectEditing {
  const tool = useAppSelector((state) => state.viewport.tool);
  // The gizmo reads these on every frame, so a change of tool needs no rebuild.
  const current = useRef<{ tool: ViewportTool; enabled: boolean }>({
    tool,
    enabled: !disabled,
  });
  useEffect(() => {
    current.current = { tool, enabled: !disabled };
  }, [tool, disabled]);

  const [selected, setSelected] = useState<SelectedObject | null>(null);
  const [error, setError] = useState("");
  const historyBusy = useRef(false);

  const save = useCallback(
    (
      change: SceneChange,
      onSuccess?: () => void,
      onFailure?: () => void,
      shouldApply?: () => boolean,
    ) => {
      if (!scene) return;
      saves.run(
        async () => {
          if (shouldApply && !shouldApply()) {
            onFailure?.();
            return;
          }
          try {
            if (change.kind === "transform") await applyTransform(scene, change);
            else await applyDelete(scene, change);
            onSuccess?.();
          } catch (failure) {
            onFailure?.();
            throw failure;
          }
        },
        (failure) => setError(errorMessage(failure)),
      );
    },
    [scene, saves],
  );

  const onTransformCommit = useCallback(
    (changes: ObjectChange[]) => {
      save({ kind: "transform", changes });
    },
    [save],
  );

  useEffect(() => {
    if (!viewport || !scene) return undefined;
    const view = {
      tool: () => current.current.tool,
      enabled: () => current.current.enabled && !historyBusy.current && !scene.requiresRecovery,
    };
    const handles = new ObjectGizmo(
      viewport,
      scene,
      {
        onLiveChange: (id, transform) =>
          setSelected((previous) =>
            previous?.id === id ? { ...previous, transform } : previous,
          ),
        onCommit: onTransformCommit,
      },
      view,
    );
    const selecting = new SelectionTools(viewport, scene, view);
    const unsubscribe = scene.onChange(() => {
      const next = describe(scene);
      setSelected(next);
    });
    return () => {
      unsubscribe();
      selecting.dispose();
      handles.dispose();
    };
  }, [viewport, scene, onTransformCommit]);

  const requestDelete = useCallback(() => {
    const ids = scene?.selectedIds;
    if (!scene || !ids || ids.length === 0 || !current.current.enabled || historyBusy.current || scene.requiresRecovery) return;
    setError("");
    save({ kind: "delete", ids });
  }, [scene, save]);

  const history = useCallback((direction: "undo" | "redo") => {
    if (!scene || !current.current.enabled || historyBusy.current || scene.requiresRecovery) return;
    historyBusy.current = true;
    saves.run(async () => {
      try { await changeSceneHistory(scene, direction); }
      finally { historyBusy.current = false; }
    }, (failure) => setError(errorMessage(failure)));
  }, [scene, saves]);
  const undo = useCallback(() => history("undo"), [history]);
  const redo = useCallback(() => history("redo"), [history]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.altKey) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
        } else if (key === "y") {
          event.preventDefault();
          redo();
        }
        return;
      }
      if (event.repeat) return;
      if (event.key === "Escape") {
        scene?.select(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scene, undo, redo]);

  const updateTransform = useCallback(
    (patch: Partial<ObjectTransform>) => {
      const id = scene?.selection;
      const before = id ? scene?.transformOf(id) : undefined;
      if (!id || !before || !current.current.enabled || historyBusy.current || scene?.requiresRecovery) return;
      setError("");
      const after = { ...before, ...patch };
      const changes = [{ id, before, after }];
      save({ kind: "transform", changes });
    },
    [scene, save],
  );

  return {
    selected,
    error,
    dismissError: () => setError(""),
    updateTransform,
    deselect: () => scene?.select(null),
    requestDelete,
  };
}
