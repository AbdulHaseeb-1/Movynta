import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene, ObjectTransform } from "@/features/assistant";
import { applyAndRecord } from "@/features/objectEditing";
import { setViewportTool, type Viewport, type ViewportTool } from "@/features/viewport3d";
import { errorMessage, type SerialQueue } from "@/lib";
import { BoneGizmo, type BoneChange } from "./BoneGizmo";
import { BoneSelection } from "./BoneSelection";
import { poseCommand, restoreBatches, type PoseBatch } from "./poseCommands";
import { RigOverlay } from "./RigOverlay";
import { boneAt, poseOf, rigOf } from "./rig";
import { describeRig, NO_RIG, rigsIn, type PosedBone, type RigInfo, type RigView } from "./rigSummary";
import { setIkChain, setPosing, setShowRig } from "./riggingSlice";

interface RigPosingOptions {
  viewport: Viewport | null;
  scene: EditorScene | null;
  /** True while the assistant is working: rigs can be looked at but not posed. */
  disabled: boolean;
  /** Where saves wait their turn; shared with the other editors of the scene. */
  saves: SerialQueue;
}

export interface RigPosing {
  /** The selected model's rig, or null when the selection has none. */
  rig: RigInfo | null;
  /** The selected bone, or null. */
  bone: PosedBone | null;
  posing: boolean;
  showRig: boolean;
  /** True when any model in the scene has a rig, so there is something to show. */
  hasRigs: boolean;
  /** How many bones above a joint bend when it is dragged with Move; zero drags the joint alone. */
  ikChain: number;
  /** Why the last change could not be saved, until it is dismissed. */
  error: string;
  dismissError: () => void;
  setPosing: (on: boolean) => void;
  setShowRig: (on: boolean) => void;
  setIkChain: (length: number) => void;
  selectBone: (index: number | null) => void;
  /** Changes some parts of the selected bone's transform, for example from typed values. */
  updateBone: (patch: Partial<ObjectTransform>) => void;
  /** Puts the selected bone back where the model file had it. */
  resetBone: () => void;
  /** Puts every bone of the selected model back where the file had it. */
  resetPose: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Showing the rigs of imported models and posing their bones. Owns the {@link RigOverlay} and the
 * {@link BoneGizmo} for the viewport and saves every finished pose, in order, with the project.
 */
export function useRigPosing({ viewport, scene, disabled, saves }: RigPosingOptions): RigPosing {
  const dispatch = useAppDispatch();
  const tool = useAppSelector((state) => state.viewport.tool);
  const posing = useAppSelector((state) => state.rigging.posing);
  const showRig = useAppSelector((state) => state.rigging.showRig);
  const ikChain = useAppSelector((state) => state.rigging.ikChain);
  // The overlay and gizmo read these on every frame, so a change needs no rebuild.
  const current = useRef<{
    tool: ViewportTool;
    enabled: boolean;
    posing: boolean;
    showRig: boolean;
    ikChain: number;
  }>({ tool, enabled: !disabled, posing, showRig, ikChain });
  useEffect(() => {
    current.current = { tool, enabled: !disabled, posing, showRig, ikChain };
  }, [tool, disabled, posing, showRig, ikChain]);

  const selection = useRef<BoneSelection | null>(null);
  const [view, setView] = useState<RigView>(NO_RIG);
  const [hasRigs, setHasRigs] = useState(false);
  const [error, setError] = useState("");

  /** Saves the poses of one or more bones as a single batch: kept together, or all taken back. */
  const save = useCallback(
    (changes: BoneChange[]) => {
      if (!scene) return;
      setError("");
      const commandsFor = (pick: (change: BoneChange) => ObjectTransform) =>
        changes.map((change) => poseCommand(change.ref.objectId, change.ref.bone, pick(change)));
      saves.run(
        () =>
          applyAndRecord(scene, {
            apply: () => {
              const commands = commandsFor((change) => change.after);
              return { applied: scene.applyUserEdit(commands), commands };
            },
            revert: () => void scene.applyUserEdit(commandsFor((change) => change.before)),
          }),
        (failure) => setError(errorMessage(failure)),
      );
    },
    [scene, saves],
  );

  const saveBatch = useCallback(
    (batch: PoseBatch) => {
      if (!scene) return;
      saves.run(
        () =>
          applyAndRecord(scene, {
            apply: () => ({ applied: scene.applyUserEdit(batch.commands), commands: batch.commands }),
            revert: () => void scene.applyUserEdit(batch.undo),
          }),
        (failure) => setError(errorMessage(failure)),
      );
    },
    [scene, saves],
  );

  useEffect(() => {
    if (!viewport || !scene) return undefined;
    const overlay = new RigOverlay(viewport, () => current.current.showRig || current.current.posing);
    const bones = new BoneSelection(scene);
    selection.current = bones;
    overlay.setRigs(rigsIn(scene));

    const gizmo = new BoneGizmo(
      viewport,
      scene,
      overlay,
      bones,
      {
        onLiveChange: ({ ref, transform }) =>
          setView((previous) =>
            previous.rig?.objectId === ref.objectId && previous.bone?.index === ref.bone
              ? { rig: previous.rig, bone: { ...previous.bone, transform } }
              : previous,
          ),
        onCommit: save,
        // A joint was clicked: a rig that is shown can be grabbed straight away.
        onPick: () => {
          if (current.current.posing) return;
          dispatch(setPosing(true));
          if (current.current.tool === "select") dispatch(setViewportTool("rotate"));
        },
      },
      {
        tool: () => current.current.tool,
        enabled: () => current.current.enabled,
        posing: () => current.current.posing,
        ikChain: () => current.current.ikChain,
      },
    );

    const stopScene = scene.onChange(() => {
      const rigs = rigsIn(scene);
      overlay.setRigs(rigs);
      setHasRigs(rigs.size > 0);
      const next = describeRig(scene, bones);
      setView(next);
      // Posing is for the selected model's bones: with a selection that has none, leave it.
      if (current.current.posing && !next.rig) dispatch(setPosing(false));
    });
    const stopSelection = bones.onChange(() => {
      overlay.setSelectedBone(bones.selected);
      setView(describeRig(scene, bones));
    });
    return () => {
      stopScene();
      stopSelection();
      gizmo.dispose();
      bones.dispose();
      overlay.dispose();
      selection.current = null;
    };
  }, [viewport, scene, save, dispatch]);

  const changePosing = useCallback(
    (on: boolean) => {
      dispatch(setPosing(on));
      // Posing needs handles: Select and Pan only click, so entering it picks the Rotate tool.
      if (on && (current.current.tool === "select" || current.current.tool === "pan"))
        dispatch(setViewportTool("rotate"));
    },
    [dispatch],
  );

  const selectBone = useCallback(
    (index: number | null) => {
      const objectId = scene?.selection;
      if (!objectId) return;
      selection.current?.select(index === null ? undefined : { objectId, bone: index });
    },
    [scene],
  );

  /** The selected bone, as it is in the scene now. */
  const boneNow = useCallback(() => {
    const ref = selection.current?.selected;
    const object = ref ? scene?.getObject(ref.objectId) : undefined;
    const rig = object ? rigOf(object) : undefined;
    const bone = ref && rig ? boneAt(rig, ref.bone) : undefined;
    return ref && rig && bone ? { ref, rig, bone } : undefined;
  }, [scene]);

  const updateBone = useCallback(
    (patch: Partial<ObjectTransform>) => {
      const found = boneNow();
      if (!found) return;
      const before = poseOf(found.bone);
      save([{ ref: found.ref, before, after: { ...before, ...patch } }]);
    },
    [boneNow, save],
  );

  const resetBone = useCallback(() => {
    const found = boneNow();
    const rest = found?.rig.rest[found.ref.bone];
    if (found && rest) save([{ ref: found.ref, before: poseOf(found.bone), after: rest }]);
  }, [boneNow, save]);

  const resetPose = useCallback(() => {
    const objectId = scene?.selection;
    const object = objectId ? scene?.getObject(objectId) : undefined;
    const rig = object ? rigOf(object) : undefined;
    if (!objectId || !rig) return;
    setError("");
    for (const batch of restoreBatches(objectId, rig)) saveBatch(batch);
  }, [scene, saveBatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.key.toLowerCase() === "p" && view.rig) {
        changePosing(!current.current.posing);
      } else if (event.key === "Escape" && current.current.posing) {
        // The first Escape lets go of the bone; the next one leaves posing.
        if (selection.current?.selected) selection.current.select(undefined);
        else changePosing(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view.rig, changePosing]);

  return {
    rig: view.rig,
    bone: view.bone,
    posing,
    showRig,
    hasRigs,
    ikChain,
    error,
    dismissError: () => setError(""),
    setPosing: changePosing,
    setShowRig: (on) => dispatch(setShowRig(on)),
    setIkChain: (length) => dispatch(setIkChain(length)),
    selectBone,
    updateBone,
    resetBone,
    resetPose,
  };
}
