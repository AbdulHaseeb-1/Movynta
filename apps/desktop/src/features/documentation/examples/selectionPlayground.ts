import { combineSelection, selectionOperation, type SelectionOperation } from "@/features/viewport3d/selectionOperation";
import type { Point } from "./transformPlayground";

/** One selectable item in the flat example, standing in for an object or a mesh component. */
export interface PlaygroundItem {
  readonly id: string;
  readonly label: string;
  readonly center: Point;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Modifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** The rectangle between two corners, whichever way it was dragged. */
export function rectFrom(a: Point, b: Point): Rect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/** The items whose centers lie in the rectangle, as box selection in the workspace counts them. */
export function itemsInRect(items: readonly PlaygroundItem[], rect: Rect): string[] {
  return items
    .filter(({ center }) => center.x >= rect.left && center.x <= rect.right && center.y >= rect.top && center.y <= rect.bottom)
    .map(({ id }) => id);
}

/** The selection after a box: Shift adds, Alt subtracts, Shift+Alt keeps only what is in the box. */
export function boxSelect(previous: readonly string[], hits: readonly string[], modifiers: Modifiers): string[] {
  return combineSelection(previous, hits, selectionOperation(modifiers));
}

/** The selection after a click: a plain click selects only that item, Shift-click adds or removes it. */
export function clickSelect(previous: readonly string[], id: string | null, modifiers: Modifiers): string[] {
  if (!modifiers.shiftKey) return id ? [id] : [];
  if (!id) return [...previous];
  return previous.includes(id) ? previous.filter((other) => other !== id) : [...previous, id];
}

const OPERATION_TEXT: Readonly<Record<SelectionOperation, string>> = {
  replace: "Replace the selection",
  add: "Add to the selection (Shift)",
  subtract: "Subtract from the selection (Alt)",
  intersect: "Keep only items in the box (Shift+Alt)",
};

/** What releasing the box will do with the modifiers held now. */
export function operationText(modifiers: Modifiers): string {
  return OPERATION_TEXT[selectionOperation(modifiers)];
}
