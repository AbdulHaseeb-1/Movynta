import type { EditorScene } from "@/features/assistant";

export interface QueuedComponentSelection {
  scene: EditorScene;
  objectId: string;
  meshPath: number[];
  ids: string[];
}

let queued: QueuedComponentSelection | null = null;

/** The next edit-mode rebuild of this scene should select these components. Clear it once the save settles. */
export function queueComponentSelection(value: QueuedComponentSelection | null): void {
  queued = value;
}

/** Takes the queued selection only for the scene and object it was queued for, so it cannot reach another project. */
export function takeComponentSelection(scene: EditorScene, objectId: string): QueuedComponentSelection | null {
  if (!queued || queued.scene !== scene || queued.objectId !== objectId) return null;
  const value = queued;
  queued = null;
  return value;
}
