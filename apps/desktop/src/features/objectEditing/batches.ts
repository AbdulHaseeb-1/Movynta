import { MAX_COMMANDS_PER_PROPOSAL } from "@movynta/editor-protocol";

/** Splits a list into runs the editor accepts as one batch of commands, keeping the order. */
export function inBatches<T>(items: readonly T[], size: number = MAX_COMMANDS_PER_PROPOSAL): T[][] {
  const batches: T[][] = [];
  for (let from = 0; from < items.length; from += size) batches.push(items.slice(from, from + size));
  return batches;
}
