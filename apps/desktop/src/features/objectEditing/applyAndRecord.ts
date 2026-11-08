import type { EditorScene, UserEdit } from "@/features/assistant";
import { recordSceneEdit } from "./sceneEditApi";

/** The message shown when a change needs the project saved first. */
export const SAVE_FIRST = "Save the project first by sending a prompt or importing a model.";

/** A change the user made by hand, and how to take it back. */
export interface UserChange {
  /** Makes the change in the scene and returns the commands that replay it. */
  apply: () => UserEdit;
  /** Puts the scene back as it was before the change. */
  revert: () => void;
}

/** How a change is saved; it is a parameter so the order of events can be tested without a backend. */
export type RecordEdit = (projectId: string, commands: readonly unknown[]) => Promise<unknown>;

/**
 * Applies a change in the scene, then saves it with the project. If it cannot be saved the scene goes
 * back, so what is shown is always what a reopened project will show. Throws a readable message
 * when the change is not kept.
 */
export async function applyAndRecord(
  scene: EditorScene,
  change: UserChange,
  record: RecordEdit = recordSceneEdit,
): Promise<void> {
  if (!scene.hasProject) {
    change.revert();
    throw new Error(SAVE_FIRST);
  }
  const edit = change.apply();
  if (!edit.applied) {
    change.revert();
    throw new Error("The change could not be applied.");
  }
  try {
    await record(scene.projectId, edit.commands);
  } catch (failure) {
    change.revert();
    throw failure;
  }
}
