/**
 * Runs asynchronous tasks one after another, in the order they were queued. Used where the order of
 * saves matters, such as changes to a project, so a slow save never lets a later one overtake it.
 */
export interface SerialQueue {
  flush: () => Promise<void>;
  /** Queues `task`. A task that fails is reported to `onError` and does not stop those behind it. */
  run: (task: () => Promise<void>, onError: (failure: unknown) => void) => void;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    flush: () => tail,
    run(task, onError) {
      tail = tail.then(task).catch(onError);
    },
  };
}
