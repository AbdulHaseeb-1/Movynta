import { useEffect, useRef, type PointerEvent } from "react";
import { ORIENTATION_AXES, orbitFromDrag, projectOrientation } from "./orientation";
import { VIEW_PRESETS } from "./viewPresets";
import type { Viewport } from "./viewport";

const CENTER = 48;
const RADIUS = 31;
const DRAG_THRESHOLD = 3;
const AXIS_COLORS = { X: "var(--axis-x)", Y: "var(--axis-y)", Z: "var(--axis-z)" } as const;

/** A camera-aligned axis indicator; its six ends select the corresponding view. */
export function OrientationGizmo({ viewport }: { viewport: Viewport | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!viewport || event.button !== 0 || drag.current) return;
    suppressClick.current = false;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!viewport || !gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.moved) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD) return;
      gesture.moved = true;
      viewport.controls.dispatchEvent({ type: "start" });
    }
    const position = orbitFromDrag(
      viewport.camera.position,
      viewport.controls.target,
      event.clientX - gesture.lastX,
      event.clientY - gesture.lastY,
      viewport.controls.minPolarAngle,
      viewport.controls.maxPolarAngle,
    );
    viewport.camera.position.copy(position);
    viewport.controls.update();
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    suppressClick.current = event.type !== "pointercancel" && gesture.moved;
    if (gesture.moved) viewport?.controls.dispatchEvent({ type: "end" });
    drag.current = null;
  };
  useEffect(() => {
    const root = rootRef.current;
    if (!viewport || !root) return undefined;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-axis]"));
    const lines = Array.from(root.querySelectorAll<SVGLineElement>("[data-line]"));
    const update = () => {
      const axes = projectOrientation(viewport.camera.quaternion);
      axes.forEach((axis, index) => {
        const x = CENTER + axis.x * RADIUS;
        const y = CENTER + axis.y * RADIUS;
        const button = buttons[index];
        if (button) {
          button.style.left = `${x}px`;
          button.style.top = `${y}px`;
          button.style.zIndex = String(Math.round((axis.depth + 1) * 100) + 1);
        }
        if (axis.positive) {
          const line = lines[index / 2];
          line?.setAttribute("x2", String(x));
          line?.setAttribute("y2", String(y));
        }
      });
    };
    update();
    return viewport.addFrameListener(update);
  }, [viewport]);

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="View orientation"
      title="Drag to orbit"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
      className="pointer-events-auto relative size-24 shrink-0 touch-none cursor-grab select-none active:cursor-grabbing"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 96 96"
        className="pointer-events-none absolute inset-0 size-full text-muted-foreground"
      >
        {(["X", "Y", "Z"] as const).map((label) => (
          <line
            key={label}
            data-line={label}
            x1={CENTER}
            y1={CENTER}
            x2={CENTER}
            y2={CENTER}
            stroke={AXIS_COLORS[label]}
            strokeWidth="1.5"
            opacity="0.9"
          />
        ))}
      </svg>
      {ORIENTATION_AXES.map((axis) => {
        const preset = VIEW_PRESETS.find((item) => item.id === axis.preset);
        return (
          <button
            key={`${axis.label}${axis.positive ? "+" : "-"}`}
            data-axis
            type="button"
            aria-label={`${preset?.label ?? axis.preset} view (${axis.positive ? "+" : "−"}${axis.label})`}
            title={`${preset?.label ?? axis.preset} view`}
            onClick={() => {
              if (preset) viewport?.setView(preset);
            }}
            style={{
              borderColor: AXIS_COLORS[axis.label],
              backgroundColor: axis.positive ? AXIS_COLORS[axis.label] : "var(--card)",
              color: axis.positive ? "var(--background)" : AXIS_COLORS[axis.label],
            }}
            className="absolute flex size-[17px] -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border text-[9px] font-bold shadow-sm transition-[filter] hover:brightness-125 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {axis.positive ? axis.label : ""}
          </button>
        );
      })}
    </div>
  );
}
