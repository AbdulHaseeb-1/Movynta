export type SelectionOperation = "replace" | "add" | "subtract" | "intersect";

/** Shift adds, Alt subtracts, and both modifiers intersect. */
export function selectionOperation(modifiers: { shiftKey: boolean; altKey: boolean }): SelectionOperation {
  if (modifiers.shiftKey && modifiers.altKey) return "intersect";
  if (modifiers.shiftKey) return "add";
  if (modifiers.altKey) return "subtract";
  return "replace";
}

/** Preserve existing selection order, with new items appended in hit order. */
export function combineSelection(
  previous: readonly string[],
  hits: readonly string[],
  operation: SelectionOperation,
): string[] {
  const matched = new Set(hits);
  if (operation === "replace") return [...matched];
  if (operation === "add") return [...new Set([...previous, ...hits])];
  return previous.filter((id) => (operation === "subtract" ? !matched.has(id) : matched.has(id)));
}
