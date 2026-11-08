/** Stop waiting for shared or non-cancellable work without cancelling the work for other callers. */
export async function waitForAbortable<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      void start()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    } catch (error) {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    }
  });
}
