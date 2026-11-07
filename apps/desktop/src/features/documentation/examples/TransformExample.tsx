import { useReducer, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { ExampleFrame, type ExampleHint } from "./ExampleFrame";
import {
  INITIAL_PLAYGROUND,
  previewShape,
  transformReducer,
  transformStatus,
  type PlaygroundShape,
  type Point,
  type TransformOperation,
} from "./transformPlayground";

const HINTS: readonly ExampleHint[] = [
  { keys: "G / R / S", label: "Move, rotate, scale" },
  { keys: "Move pointer", label: "Adjust the preview" },
  { keys: "X / Y", label: "Constrain to an axis" },
  { keys: "Type a number / Backspace", label: "Exact value" },
  { keys: "Enter / Click", label: "Confirm" },
  { keys: "Esc / Right-click", label: "Cancel" },
  { keys: "Ctrl+Z", label: "Undo" },
];

/** The visible part of the scene, in scene units. */
const VIEW = { width: 12, height: 7 } as const;
const HALF = 0.8;
const OPERATIONS: Readonly<Record<string, TransformOperation>> = { g: "move", r: "rotate", s: "scale" };

function shapeTransform(shape: PlaygroundShape): string {
  // The scene's Y points up; the drawing is flipped once, around the whole scene.
  return `translate(${shape.x} ${shape.y}) rotate(${shape.rotation}) scale(${shape.scaleX} ${shape.scaleY})`;
}

function Shape({ shape, ghost }: { readonly shape: PlaygroundShape; readonly ghost?: boolean }) {
  return (
    <g transform={shapeTransform(shape)} opacity={ghost ? 0.45 : 1}>
      <rect
        x={-HALF}
        y={-HALF}
        width={HALF * 2}
        height={HALF * 2}
        rx={0.12}
        vectorEffect="non-scaling-stroke"
        className={ghost ? "fill-none stroke-muted-foreground" : "fill-secondary stroke-foreground"}
        strokeWidth={ghost ? 1 : 1.5}
        strokeDasharray={ghost ? "4 3" : undefined}
      />
      {/* The notch shows which way is up, so rotation is visible. */}
      <path d={`M ${-0.22} ${HALF - 0.32} L 0 ${HALF - 0.08} L 0.22 ${HALF - 0.32} Z`} className={ghost ? "fill-muted-foreground" : "fill-foreground"} />
    </g>
  );
}

/**
 * A flat stand-in for the workspace's keyboard transform: the same keys, the same preview-then-confirm flow,
 * and the same status line, on one shape seen from the front.
 */
export function TransformExample() {
  const [state, dispatch] = useReducer(transformReducer, INITIAL_PLAYGROUND);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointer = useRef<Point | null>(null);
  const preview = previewShape(state);
  const session = state.session;

  const toScene = (clientX: number, clientY: number): Point | null => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: local.x, y: -local.y };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      dispatch({ type: "undo" });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const operation = OPERATIONS[key];
    if (operation) {
      event.preventDefault();
      dispatch({ type: "start", operation, pointer: pointer.current ?? { x: state.shape.x + 1.5, y: state.shape.y } });
      return;
    }
    if (!session) return;
    if (key === "x" || key === "y") dispatch({ type: "axis", axis: key });
    else if (/^[0-9.-]$/.test(key)) dispatch({ type: "type", text: key });
    else if (key === "backspace") dispatch({ type: "backspace" });
    else if (key === "enter") dispatch({ type: "confirm" });
    else if (key === "escape") dispatch({ type: "cancel" });
    else return;
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const point = toScene(event.clientX, event.clientY);
    if (!point) return;
    pointer.current = point;
    if (session) dispatch({ type: "pointer", pointer: point });
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!session) return;
    if (event.button === 0) dispatch({ type: "confirm" });
    else if (event.button === 2) dispatch({ type: "cancel" });
  };

  const axisLine = session?.axis;
  return (
    <ExampleFrame
      title="Move, rotate and scale with the keyboard"
      hints={HINTS}
      status={transformStatus(state)}
      onReset={() => dispatch({ type: "reset" })}
      onKeyDown={onKeyDown}
      onFocusChange={(focused) => { if (!focused) dispatch({ type: "cancel" }); }}
      footnote={<>Try <strong className="font-medium text-foreground">G</strong>, then <strong className="font-medium text-foreground">X</strong>, type <strong className="font-medium text-foreground">2</strong> and press Enter: the shape moves exactly 2 units right. In the workspace Z works too.</>}
    >
      <svg
        ref={svgRef}
        viewBox={`${-VIEW.width / 2} ${-VIEW.height / 2} ${VIEW.width} ${VIEW.height}`}
        className="size-full"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        <g transform="scale(1 -1)">
          {Array.from({ length: VIEW.width + 1 }, (_, index) => index - VIEW.width / 2).map((x) => (
            <line key={`x${x}`} x1={x} y1={-VIEW.height} x2={x} y2={VIEW.height} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {Array.from({ length: VIEW.height + 1 }, (_, index) => index - Math.floor(VIEW.height / 2)).map((y) => (
            <line key={`y${y}`} x1={-VIEW.width} y1={y} x2={VIEW.width} y2={y} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={-VIEW.width} y1={0} x2={VIEW.width} y2={0} style={{ stroke: "var(--axis-x)" }} strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={-VIEW.height} x2={0} y2={VIEW.height} style={{ stroke: "var(--axis-y)" }} strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {axisLine && (
            <line
              x1={axisLine === "x" ? -VIEW.width : state.shape.x}
              y1={axisLine === "x" ? state.shape.y : -VIEW.height}
              x2={axisLine === "x" ? VIEW.width : state.shape.x}
              y2={axisLine === "x" ? state.shape.y : VIEW.height}
              style={{ stroke: axisLine === "x" ? "var(--axis-x)" : "var(--axis-y)" }}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {session && <Shape shape={state.shape} ghost />}
          <Shape shape={preview} />
        </g>
      </svg>
    </ExampleFrame>
  );
}
