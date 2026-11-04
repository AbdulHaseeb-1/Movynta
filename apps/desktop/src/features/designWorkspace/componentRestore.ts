export interface QueuedComponentSelection {
  objectId: string;
  meshPath: number[];
  ids: string[];
}

let queued: QueuedComponentSelection | null = null;

/** The next edit-mode rebuild should select these components. */
export function queueComponentSelection(value: QueuedComponentSelection | null): void {
  queued = value;
}

/** Takes the queued selection when the rebuilt object is the one that was extruded. */
export function takeComponentSelection(objectId: string): QueuedComponentSelection | null {
  if (!queued || queued.objectId !== objectId) return null;
  const value = queued;
  queued = null;
  return value;
}
