/**
 * A flat model of the workspace's keyboard transform (G, R, S), for the interactive example in the
 * documentation. It follows the rules of `objectEditing/KeyboardTransform.ts`: the edit is a preview until it is
 * confirmed, X and Y constrain an axis and pressing the same one again releases it, a typed number replaces the
 * pointer, and scale factors must be from 0.001 to 100. Units are scene units with Y pointing up.
 */

export type TransformOperation = "move" | "rotate" | "scale";
export type PlaygroundAxis = "x" | "y";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PlaygroundShape {
  readonly x: number;
  readonly y: number;
  /** Degrees, counterclockwise. */
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface TransformSession {
  readonly operation: TransformOperation;
  readonly axis: PlaygroundAxis | null;
  /** Where the pointer was when the transform started. */
  readonly start: Point;
  readonly pointer: Point;
  readonly numeric: string;
}

export interface TransformPlayground {
  readonly shape: PlaygroundShape;
  readonly session: TransformSession | null;
  /** Confirmed shapes before the current one, for Ctrl+Z. */
  readonly history: readonly PlaygroundShape[];
  /** The last thing that happened, shown under the example. */
  readonly message: string;
}

export const INITIAL_SHAPE: PlaygroundShape = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

export const INITIAL_PLAYGROUND: TransformPlayground = {
  shape: INITIAL_SHAPE,
  session: null,
  history: [],
  message: "Press G, R or S to start.",
};

const MIN_SCALE = 0.001;
const MAX_SCALE = 100;
const NUMERIC_PATTERN = /^-?\d*(\.\d*)?$/;
const MAX_NUMERIC_LENGTH = 16;
/** Scale stops short of zero while dragging, so the shape never flips or vanishes. */
const MIN_DRAG_SCALE = 0.05;

const LABEL: Readonly<Record<TransformOperation, string>> = { move: "Move", rotate: "Rotate", scale: "Scale" };

function capitalize(axis: PlaygroundAxis): string {
  return axis.toUpperCase();
}

/** The typed value, or null when nothing usable has been typed yet ("" or "-"). */
function typedNumber(session: TransformSession): number | null {
  if (session.numeric === "" || session.numeric === "-" || session.numeric === ".") return null;
  const value = Number(session.numeric);
  return Number.isFinite(value) ? value : null;
}

/** Why the typed value cannot be confirmed, or undefined when it can. */
export function numericError(session: TransformSession): string | undefined {
  if (session.numeric === "") return undefined;
  const value = typedNumber(session);
  if (value === null) return "Enter a valid number";
  if (session.operation === "scale" && (value < MIN_SCALE || value > MAX_SCALE))
    return "Enter a valid number from 0.001 to 100";
  return undefined;
}

function angleOf(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function normalizeDegrees(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** The shape as the current preview shows it. Without a session this is the confirmed shape. */
export function previewShape(state: TransformPlayground): PlaygroundShape {
  const { shape, session } = state;
  if (!session || numericError(session)) return shape;
  const typed = typedNumber(session);
  const pivot = { x: shape.x, y: shape.y };
  switch (session.operation) {
    case "move": {
      if (typed !== null) {
        // Without an axis a typed distance follows screen-right, as it follows camera-right in the app.
        const axis = session.axis ?? "x";
        return axis === "x" ? { ...shape, x: shape.x + typed } : { ...shape, y: shape.y + typed };
      }
      const dx = session.axis === "y" ? 0 : session.pointer.x - session.start.x;
      const dy = session.axis === "x" ? 0 : session.pointer.y - session.start.y;
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    }
    case "rotate": {
      const turn = typed ?? angleOf(pivot, session.pointer) - angleOf(pivot, session.start);
      return { ...shape, rotation: normalizeDegrees(shape.rotation + turn) };
    }
    case "scale": {
      const startDistance = Math.hypot(session.start.x - pivot.x, session.start.y - pivot.y);
      const dragged =
        startDistance > 1e-6
          ? Math.max(
              MIN_DRAG_SCALE,
              Math.hypot(session.pointer.x - pivot.x, session.pointer.y - pivot.y) / startDistance,
            )
          : 1;
      const factor = typed ?? dragged;
      return {
        ...shape,
        scaleX: session.axis === "y" ? shape.scaleX : shape.scaleX * factor,
        scaleY: session.axis === "x" ? shape.scaleY : shape.scaleY * factor,
      };
    }
    default: {
      const unknown: never = session.operation;
      throw new Error(`Unknown transform ${String(unknown)}`);
    }
  }
}

/** The status line, in the same form the workspace shows during a keyboard transform. */
export function transformStatus(state: TransformPlayground): string {
  const { session } = state;
  if (!session) return state.message;
  const error = numericError(session);
  if (error) return `${error} · Esc cancels`;
  const axis = session.axis ? ` · ${capitalize(session.axis)}` : "";
  const typed = session.numeric ? ` · ${session.numeric}${session.operation === "rotate" ? "°" : ""}` : "";
  return `${LABEL[session.operation]}${axis}${typed}  ·  Type a value · X/Y constrain  ·  Click or Enter confirm  ·  Esc cancel`;
}

export type PlaygroundAction =
  | { readonly type: "start"; readonly operation: TransformOperation; readonly pointer: Point }
  | { readonly type: "pointer"; readonly pointer: Point }
  | { readonly type: "axis"; readonly axis: PlaygroundAxis }
  | { readonly type: "type"; readonly text: string }
  | { readonly type: "backspace" }
  | { readonly type: "confirm" }
  | { readonly type: "cancel" }
  | { readonly type: "undo" }
  | { readonly type: "reset" };

function describe(shape: PlaygroundShape): string {
  const round = (value: number) => Number(value.toFixed(2));
  return `position (${round(shape.x)}, ${round(shape.y)}) · rotation ${round(shape.rotation)}° · scale ${round(shape.scaleX)} × ${round(shape.scaleY)}`;
}

/** Applies one key or pointer action. Actions that do not apply in the current state change nothing. */
export function transformReducer(state: TransformPlayground, action: PlaygroundAction): TransformPlayground {
  const { session } = state;
  switch (action.type) {
    case "start":
      // As in the app, G, R and S do nothing while a transform is running: confirm or cancel it first.
      if (session) return state;
      return {
        ...state,
        session: {
          operation: action.operation,
          axis: null,
          start: action.pointer,
          pointer: action.pointer,
          numeric: "",
        },
      };
    case "pointer":
      return session ? { ...state, session: { ...session, pointer: action.pointer } } : state;
    case "axis":
      if (!session) return state;
      if (session.operation === "rotate") {
        return { ...state, message: "This flat example always rotates around the view axis." };
      }
      return { ...state, session: { ...session, axis: session.axis === action.axis ? null : action.axis } };
    case "type": {
      if (!session) return state;
      const numeric = session.numeric + action.text;
      if (!NUMERIC_PATTERN.test(numeric) || numeric.length > MAX_NUMERIC_LENGTH) return state;
      return { ...state, session: { ...session, numeric } };
    }
    case "backspace":
      return session ? { ...state, session: { ...session, numeric: session.numeric.slice(0, -1) } } : state;
    case "confirm": {
      if (!session || numericError(session)) return state;
      const shape = previewShape(state);
      return {
        shape,
        session: null,
        history: [...state.history, state.shape],
        message: `${LABEL[session.operation]} confirmed: ${describe(shape)}. Ctrl+Z undoes it.`,
      };
    }
    case "cancel":
      return session
        ? { ...state, session: null, message: `${LABEL[session.operation]} cancelled; the shape is back where it was.` }
        : state;
    case "undo": {
      if (session) return state;
      const previous = state.history[state.history.length - 1];
      if (!previous) return { ...state, message: "Nothing to undo." };
      return {
        shape: previous,
        session: null,
        history: state.history.slice(0, -1),
        message: `Undone: ${describe(previous)}.`,
      };
    }
    case "reset":
      return INITIAL_PLAYGROUND;
    default: {
      const unknown: never = action;
      throw new Error(`Unknown action ${JSON.stringify(unknown)}`);
    }
  }
}
