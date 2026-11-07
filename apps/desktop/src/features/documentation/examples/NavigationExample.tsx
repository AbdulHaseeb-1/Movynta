import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Box3,
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  type Object3D,
} from "three";
import { addCoordinateSpace, updateCoordinateSpace } from "@/features/viewport3d/coordinateSpace";
import { isClick, type Press } from "@/features/viewport3d/clicks";
import { OrientationGizmo } from "@/features/viewport3d/OrientationGizmo";
import { ThreeViewport } from "@/features/viewport3d/ThreeViewport";
import { ZOOM_STEP } from "@/features/viewport3d/useViewportShortcuts";
import type { Viewport } from "@/features/viewport3d/viewport";
import { viewportShortcut } from "@/features/viewport3d/viewportShortcuts";
import { DEFAULT_VIEWPORT_DISPLAY } from "@/features/viewport3d/viewportStorage";
import {
  setViewportTool,
  toggleWireframe,
  toggleXray,
  viewportReducer,
  xrayActive,
  type ViewportState,
} from "@/features/viewport3d/viewportSlice";
import { ExampleFrame, type ExampleHint } from "./ExampleFrame";

const HINTS: readonly ExampleHint[] = [
  { keys: "Drag", label: "Orbit" },
  { keys: "H / Space+Drag", label: "Pan" },
  { keys: "Scroll / + / −", label: "Zoom" },
  { keys: "0", label: "Reset view" },
  { keys: "Numpad 1 / Numpad 3 / Numpad 7", label: "Front, right, top" },
  { keys: "Ctrl+Numpad 1", label: "Back (and so on)" },
  { keys: "Click / .", label: "Select, frame selected" },
  { keys: "Home", label: "Frame all" },
  { keys: "Shift+Z", label: "Wireframe" },
  { keys: "Alt+Z", label: "X-ray" },
];

/** The example keeps its own display settings, so trying it never changes how the workspace draws. */
const INITIAL_DISPLAY: ViewportState = { tool: "select", display: DEFAULT_VIEWPORT_DISPLAY };

function token(name: string): Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(value || "white");
}

interface ExampleScene {
  readonly model: Group;
  readonly grid: Group;
}

/** A cube with a marker on each positive axis, colored like the gizmo, so each view is easy to recognize. */
function buildScene(viewport: Viewport): ExampleScene & { readonly stop: () => void } {
  const model = new Group();
  const body = new Mesh(
    new BoxGeometry(1.6, 1.6, 1.6),
    new MeshStandardMaterial({ color: token("--muted-foreground"), roughness: 0.6 }),
  );
  body.name = "Cube";
  const markers: readonly { name: string; color: string; position: [number, number, number]; cone?: boolean }[] = [
    { name: "+X marker", color: "--axis-x", position: [1.6, 0, 0] },
    { name: "+Y marker", color: "--axis-y", position: [0, 1.6, 0], cone: true },
    { name: "+Z marker", color: "--axis-z", position: [0, 0, 1.6] },
  ];
  model.add(body);
  for (const marker of markers) {
    const geometry = marker.cone ? new ConeGeometry(0.35, 0.7, 24) : new SphereGeometry(0.35, 24, 16);
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: token(marker.color), roughness: 0.45 }));
    mesh.name = marker.name;
    mesh.position.set(...marker.position);
    model.add(mesh);
  }
  model.position.y = 0.8;
  viewport.scene.add(model);
  viewport.setShadingModelPredicate((object) => object.parent === model);

  const grid = addCoordinateSpace(viewport.scene);
  const updateGrid = () => updateCoordinateSpace(grid, viewport.controls.target, viewport.controls.getDistance());
  updateGrid();
  const stop = viewport.addFrameListener(updateGrid);
  return { model, grid, stop };
}

/**
 * The real workspace viewport, camera controls and navigation keys on a small scene. The keys go through the
 * same `viewportShortcut` mapping and display rules as the workspace.
 */
export function NavigationExample() {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [state, dispatch] = useReducer(viewportReducer, INITIAL_DISPLAY);
  const [status, setStatus] = useState("Drag to orbit, scroll to zoom. Click the cube or a marker to select it.");
  const scene = useRef<ExampleScene | null>(null);
  const selected = useRef<Object3D | null>(null);
  const press = useRef<Press | null>(null);

  const onReady = useCallback((next: Viewport) => {
    const built = buildScene(next);
    scene.current = built;
    setViewport(next);
    return () => {
      built.stop();
      scene.current = null;
      selected.current = null;
      setViewport(null);
    };
  }, []);

  useEffect(() => {
    if (!viewport) return;
    viewport.setShadingMode(state.display.shadingMode, xrayActive(state.display));
    if (scene.current) scene.current.grid.visible = state.display.showGrid;
  }, [viewport, state.display]);

  useEffect(() => {
    viewport?.setNavigationTool(state.tool === "pan" ? "pan" : "select");
  }, [viewport, state.tool]);

  const select = (object: Object3D | null) => {
    selected.current = object;
    viewport?.setOutlinedObjects(object ? [object] : []);
    setStatus(object ? `Selected ${object.name}. Press . to frame it.` : "Selection cleared.");
  };

  const frame = (scope: "selection" | "all") => {
    const model = scene.current?.model;
    if (!viewport || !model) return;
    const target = scope === "selection" && selected.current ? selected.current : model;
    viewport.frameBox(new Box3().setFromObject(target));
    setStatus(target === model ? "Framed the whole scene." : `Framed ${target.name}.`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The viewport handles a held Space itself; keep the page from scrolling while it does.
    if (event.code === "Space") {
      event.preventDefault();
      return;
    }
    const key = event.key.toLowerCase();
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat && (key === "h" || key === "v")) {
      event.preventDefault();
      const tool = key === "h" && state.tool !== "pan" ? "pan" : "select";
      dispatch(setViewportTool(tool));
      setStatus(
        tool === "pan" ? "Hand tool: drag to pan. Press V to go back to orbiting." : "Select tool: drag to orbit.",
      );
      return;
    }
    if (key === "escape") {
      event.preventDefault();
      select(null);
      return;
    }
    const shortcut = viewportShortcut(event.nativeEvent);
    if (!shortcut || !viewport) return;
    event.preventDefault();
    switch (shortcut.kind) {
      case "view":
        viewport.setView(shortcut.preset);
        setStatus(`${shortcut.preset.label} view.`);
        return;
      case "zoom":
        viewport.zoomBy(shortcut.direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
        setStatus(shortcut.direction === "in" ? "Zoomed in." : "Zoomed out.");
        return;
      case "reset":
        viewport.resetView();
        setStatus("Back to the starting view.");
        return;
      case "frame":
        frame(shortcut.scope);
        return;
      case "toggle-wireframe": {
        const next = viewportReducer(state, toggleWireframe());
        dispatch(toggleWireframe());
        setStatus(
          next.display.shadingMode === "wireframe"
            ? "Wireframe on. Shift+Z again returns to the shading before it."
            : `Back to ${next.display.shadingMode === "solid" ? "Solid" : "Material"} shading.`,
        );
        return;
      }
      case "toggle-xray": {
        const next = viewportReducer(state, toggleXray());
        dispatch(toggleXray());
        setStatus(
          xrayActive(next.display)
            ? `X-ray on${state.display.shadingMode === "default" ? ": the material view has no X-ray, so it switched to Solid" : ""}.`
            : "X-ray off.",
        );
        return;
      }
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    press.current = event.button === 0 ? { x: event.clientX, y: event.clientY, time: performance.now() } : null;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    press.current = null;
    const model = scene.current?.model;
    if (!start || !viewport || !model || !isClick(start, event.clientX, event.clientY, performance.now())) return;
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const bounds = event.target.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, viewport.camera);
    select(raycaster.intersectObjects(model.children, false)[0]?.object ?? null);
  };

  return (
    <ExampleFrame
      title="Navigate the viewport"
      hints={HINTS}
      status={status}
      onReset={() => {
        viewport?.resetView();
        dispatch(setViewportTool("select"));
        select(null);
        setStatus("Back to the starting view.");
      }}
      onKeyDown={onKeyDown}
      footnote="No numpad? Click an axis on the gizmo. Front looks from +Z (blue), right from +X (red) and top from +Y (green)."
    >
      <div className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <ThreeViewport onReady={onReady} />
      </div>
      <div className="absolute top-2 right-2">
        <OrientationGizmo viewport={viewport} />
      </div>
    </ExampleFrame>
  );
}
