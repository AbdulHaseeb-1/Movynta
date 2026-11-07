import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { ExampleFrame, type ExampleHint } from "./ExampleFrame";
import { boxSelect, clickSelect, itemsInRect, operationText, rectFrom, type Modifiers, type PlaygroundItem } from "./selectionPlayground";
import type { Point } from "./transformPlayground";

const HINTS: readonly ExampleHint[] = [
  { keys: "Click", label: "Select one" },
  { keys: "Shift+Click", label: "Add or remove one" },
  { keys: "Drag / B then Drag", label: "Box select" },
  { keys: "Shift+Drag", label: "Box adds" },
  { keys: "Alt+Drag", label: "Box subtracts" },
  { keys: "Shift+Alt+Drag", label: "Box intersects" },
  { keys: "A / Alt+A", label: "Select all, clear" },
  { keys: "Esc", label: "Cancel box or clear" },
];

const ITEMS: readonly PlaygroundItem[] = [
  { id: "cube", label: "Cube", center: { x: 18, y: 16 } },
  { id: "sphere", label: "Sphere", center: { x: 40, y: 12 } },
  { id: "cone", label: "Cone", center: { x: 62, y: 20 } },
  { id: "torus", label: "Torus", center: { x: 86, y: 13 } },
  { id: "plane", label: "Plane", center: { x: 104, y: 30 } },
  { id: "cylinder", label: "Cylinder", center: { x: 26, y: 40 } },
  { id: "icosahedron", label: "Icosahedron", center: { x: 50, y: 46 } },
  { id: "octahedron", label: "Octahedron", center: { x: 76, y: 42 } },
  { id: "tetrahedron", label: "Tetrahedron", center: { x: 96, y: 50 } },
];
const VIEW = { width: 120, height: 60 } as const;
const ITEM_RADIUS = 3.2;
/** How far the pointer may move, in scene units, before a press counts as a drag. */
const DRAG_THRESHOLD = 1.2;

interface Gesture {
  readonly pointerId: number;
  readonly start: Point;
  readonly current: Point;
  /** The item under the press, if any; a drag that starts on an item without B does not box select. */
  readonly item: string | null;
  readonly box: boolean;
}

function selectionText(selected: readonly string[]): string {
  if (selected.length === 0) return "Nothing selected.";
  const names = ITEMS.filter(({ id }) => selected.includes(id)).map(({ label }) => label);
  return `Selected ${selected.length} of ${ITEMS.length}: ${names.join(", ")}.`;
}

/** Click and box selection with the workspace's modifiers, on a flat set of objects seen from above. */
export function SelectionExample() {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [armed, setArmed] = useState(false);
  const [modifiers, setModifiers] = useState<Modifiers>({ shiftKey: false, altKey: false });
  const [message, setMessage] = useState("Click an object, or drag across empty space.");
  const svgRef = useRef<SVGSVGElement>(null);

  const toScene = (clientX: number, clientY: number): Point | null => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };
  const update = (next: readonly string[], text?: string) => {
    setSelected(next);
    setMessage(text ?? selectionText(next));
  };
  const trackModifiers = (event: { shiftKey: boolean; altKey: boolean }) => {
    if (event.shiftKey !== modifiers.shiftKey || event.altKey !== modifiers.altKey) {
      setModifiers({ shiftKey: event.shiftKey, altKey: event.altKey });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    trackModifiers(event);
    // Alt on its own would move focus to the window menu on some systems.
    if (event.key === "Alt") { event.preventDefault(); return; }
    if (event.ctrlKey || event.metaKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "a") update(event.altKey ? [] : ITEMS.map(({ id }) => id));
    else if (key === "b" && !event.altKey) { setArmed(true); setMessage("Box select: drag a rectangle, even over objects."); }
    else if (key === "escape") {
      if (gesture?.box || armed) { setGesture(null); setArmed(false); setMessage("Box cancelled."); }
      else update([]);
    } else return;
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || gesture) return;
    const point = toScene(event.clientX, event.clientY);
    if (!point) return;
    trackModifiers(event);
    const hit = event.target instanceof Element ? event.target.closest("[data-item]")?.getAttribute("data-item") ?? null : null;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ pointerId: event.pointerId, start: point, current: point, item: hit, box: armed });
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    trackModifiers(event);
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = toScene(event.clientX, event.clientY);
    if (!point) return;
    const moved = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > DRAG_THRESHOLD;
    setGesture({ ...gesture, current: point, box: gesture.box || (moved && gesture.item === null) });
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const held = { shiftKey: event.shiftKey, altKey: event.altKey };
    setGesture(null);
    setArmed(false);
    if (gesture.box) {
      const hits = itemsInRect(ITEMS, rectFrom(gesture.start, gesture.current));
      const next = boxSelect(selected, hits, held);
      update(next, `${operationText(held)}: ${hits.length} in the box. ${selectionText(next)}`);
      return;
    }
    const moved = Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y) > DRAG_THRESHOLD;
    if (!moved) update(clickSelect(selected, gesture.item, held));
  };

  const rect = gesture?.box ? rectFrom(gesture.start, gesture.current) : null;
  const status = rect ? `${operationText(modifiers)} · release to apply · Esc cancels` : message;

  return (
    <ExampleFrame
      title="Select, Shift-click and box select"
      hints={HINTS}
      status={status}
      onReset={() => { setGesture(null); setArmed(false); update([], "Click an object, or drag across empty space."); }}
      onKeyDown={onKeyDown}
      onKeyUp={trackModifiers}
      onFocusChange={(focused) => { if (!focused) { setGesture(null); setArmed(false); setModifiers({ shiftKey: false, altKey: false }); } }}
      footnote="Like the workspace, a box counts an object when its center is inside. In Edit mode the same keys select vertices, edges and faces."
      stageClassName={cn(armed && "cursor-crosshair")}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className="size-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setGesture(null)}
      >
        {ITEMS.map((item) => {
          const isSelected = selected.includes(item.id);
          const isActive = selected[selected.length - 1] === item.id;
          return (
            <g key={item.id} data-item={item.id} className="cursor-pointer">
              {isSelected && <circle cx={item.center.x} cy={item.center.y} r={ITEM_RADIUS + 1.1} className={isActive ? "fill-none stroke-foreground" : "fill-none stroke-muted-foreground"} strokeWidth={0.5} />}
              <circle
                cx={item.center.x}
                cy={item.center.y}
                r={ITEM_RADIUS}
                className={isSelected ? "fill-foreground" : "fill-secondary stroke-muted-foreground"}
                strokeWidth={0.35}
              />
              <circle cx={item.center.x} cy={item.center.y} r={0.5} className={isSelected ? "fill-background" : "fill-muted-foreground"} />
              <text x={item.center.x} y={item.center.y + ITEM_RADIUS + 3.6} textAnchor="middle" className={cn("text-[2.6px]", isSelected ? "fill-foreground" : "fill-muted-foreground")}>
                {item.label}
              </text>
            </g>
          );
        })}
        {rect && (
          <rect
            x={rect.left}
            y={rect.top}
            width={rect.right - rect.left}
            height={rect.bottom - rect.top}
            className="fill-foreground/10 stroke-foreground"
            strokeWidth={0.3}
            strokeDasharray="1.2 0.8"
          />
        )}
      </svg>
    </ExampleFrame>
  );
}
