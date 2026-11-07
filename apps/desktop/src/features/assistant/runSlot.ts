/** Proof that a request holds the conversation. Only the holder's own release gives it up. */
export type RunLease = symbol;

/**
 * Lets one request at a time own the conversation. A request that was stopped hands the conversation over at once
 * with `drop`, although it may still be winding down, so the next message is not refused. Its late `release` then
 * changes nothing, because the lease it holds is no longer the current one.
 */
export class RunSlot {
  private current: RunLease | undefined;

  /** Takes the conversation, or returns undefined while another request holds it. */
  acquire(): RunLease | undefined {
    if (this.current) return undefined;
    this.current = Symbol("run");
    return this.current;
  }

  /** Gives the conversation up, unless the lease was already dropped and someone else holds it now. */
  release(lease: RunLease): void {
    if (this.current === lease) this.current = undefined;
  }

  /** Frees the conversation whoever holds it, for a request that has been stopped. */
  drop(): void {
    this.current = undefined;
  }

  /** Whether the lease is the one that currently holds the conversation. */
  holds(lease: RunLease): boolean {
    return this.current === lease;
  }
}

/** Runs an action once at a time per key, so a double click on a button sends one request and not two. */
export class OncePerKey {
  private readonly busy = new Set<string>();

  /** Runs `action` unless one with the same key is still running. Resolves to false when it was skipped. */
  async run(key: string, action: () => Promise<void>): Promise<boolean> {
    if (this.busy.has(key)) return false;
    this.busy.add(key);
    try {
      await action();
      return true;
    } finally {
      this.busy.delete(key);
    }
  }
}
