import {
  AmbientLight,
  Color,
  DirectionalLight,
  Line,
  MathUtils,
  Mesh,
  MOUSE,
  PerspectiveCamera,
  Points,
  Scene,
  Timer,
  Vector3,
  WebGLRenderer,
  type Box3,
  type ColorRepresentation,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createShadingRenderer, type ShadingMode } from "./shading";
import { framePose } from "./framing";
import { viewPosition, type ViewPreset } from "./viewPresets";
import { createOutlineRenderer } from "./outline";
import { createCameraEase } from "./cameraEase";
import { isTypingTarget } from "@/lib/dom";

export type FrameListener = (deltaSeconds: number) => void;

export interface ViewportOptions {
  // Omit to keep the canvas transparent so the page behind it shows through.
  background?: ColorRepresentation;
  maxPixelRatio?: number;
}

// "select" is the default tool: dragging orbits the camera. "pan" makes dragging move the view instead.
export type NavigationTool = "select" | "pan";

export type NavigationScope = "rotate" | "full";

export interface Viewport {
  scene: Scene;
  setShadingMode: (mode: ShadingMode, xray: boolean) => void;
  setShadingModelPredicate: (predicate: (object: Object3D) => boolean) => void;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  setNavigationTool: (tool: NavigationTool) => void;
  // Edit mode uses left-drag for selection and right-drag for orbit.
  setEditNavigation: (enabled: boolean) => void;
  // "rotate" limits the view to orbiting; "full" also allows pan, zoom, and Space + drag. Defaults to "full".
  setNavigationScope: (scope: NavigationScope) => void;
  // Moves the camera toward (factor > 1) or away from (factor < 1) the orbit target, with a short ease.
  zoomBy: (factor: number) => void;
  // Eases the camera back to its starting view.
  resetView: () => void;
  // Looks at the same target from a preset direction (front, top, ...), at the same distance.
  setView: (preset: ViewPreset) => void;
  // Eases the camera to look at the middle of this box from the current direction, far enough to show it whole.
  frameBox: (box: Box3) => void;
  // Shifts the view right while the assistant panel is open, then restores its previous center.
  setAssistantPanelOpen: (open: boolean) => void;
  // Runs before each frame renders. Returns a function that removes the listener.
  addFrameListener: (listener: FrameListener) => () => void;
  // Draws an orange outline around these objects, as Blender does for a selection. An empty list clears it.
  setOutlinedObjects: (objects: readonly Object3D[]) => void;
  dispose: () => void;
}

const DEFAULT_MAX_PIXEL_RATIO = 2;
const CAMERA_FOV = 45;
const CAMERA_NEAR = 0.01;
const CAMERA_FAR = 5000;
const CAMERA_START = new Vector3(5, 4, 7);
const ORBIT_MIN_DISTANCE = 0.05;
const ORBIT_MAX_DISTANCE = 500;
const ORBIT_DAMPING = 0.08;
const EASE_SECONDS = 0.35;
const ASSISTANT_PANEL_SHIFT_FRACTION = 0.12;


interface SpacePanCallbacks {
  // Called when Space is pressed or released outside a text field.
  onHeldChange: (held: boolean) => void;
  // Called when a drag starts or ends on the canvas.
  onDragChange: (dragging: boolean) => void;
}

// Holding Space temporarily switches dragging from orbit to pan, so the view can be moved in every direction.
// Space is ignored while typing in a field. Returns a function that removes the listeners.
function enableSpacePan(
  element: HTMLElement,
  { onHeldChange, onDragChange }: SpacePanCallbacks,
): () => void {
  let held = false;

  const release = () => {
    if (!held) return;
    held = false;
    onHeldChange(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Space" || isTypingTarget(event.target)) return;
    if (event.target === document.body || event.target === element)
      event.preventDefault();
    if (held) return;
    held = true;
    onHeldChange(true);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space") release();
  };
  const onPointerDown = () => onDragChange(true);
  const onPointerUp = () => onDragChange(false);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", release);
  element.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", release);
    element.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    release();
  };
}

type GeometryObject = Mesh | Line | Points;

// `instanceof` narrows generic classes to `Mesh<any>`, so a typed predicate keeps the types strict.
function hasGeometry(object: Object3D): object is GeometryObject {
  return (
    object instanceof Mesh || object instanceof Line || object instanceof Points
  );
}

// Creates a Three.js renderer, scene, camera, lights, and orbit controls inside `container`,
// and keeps the canvas sized to the container. Call `dispose` to stop the loop and release GPU resources.
export function createViewport(
  container: HTMLElement,
  options: ViewportOptions = {},
): Viewport {
  const { background, maxPixelRatio = DEFAULT_MAX_PIXEL_RATIO } = options;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  if (background !== undefined) scene.background = new Color(background);
  scene.add(new AmbientLight(0xffffff, 0.6));

  const keyLight = new DirectionalLight(0xffffff, 2);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.copy(CAMERA_START);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = ORBIT_DAMPING;
  controls.minDistance = ORBIT_MIN_DISTANCE;
  controls.maxDistance = ORBIT_MAX_DISTANCE;
  controls.screenSpacePanning = true;
  controls.update();

  // Dragging pans when the Hand tool is active or Space is held; otherwise it orbits.
  let tool: NavigationTool = "select";
  let spaceHeld = false;
  let dragging = false;
  let fullNavigation = true;
  const applyNavigation = () => {
    controls.enablePan = fullNavigation;
    controls.enableZoom = fullNavigation;
    const panning = fullNavigation && (tool === "pan" || spaceHeld);
    controls.mouseButtons.LEFT = panning ? MOUSE.PAN : MOUSE.ROTATE;
    renderer.domElement.style.cursor = panning
      ? dragging
        ? "grabbing"
        : "grab"
      : "";
  };
  const disableSpacePan = enableSpacePan(renderer.domElement, {
    onHeldChange: (held) => {
      spaceHeld = held;
      if (!held) dragging = false;
      applyNavigation();
    },
    onDragChange: (next) => {
      dragging = next;
      applyNavigation();
    },
  });

  const outline = createOutlineRenderer(renderer, scene, camera);
  const shading = createShadingRenderer(scene, renderer, camera);

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    renderer.setSize(width, height);
    outline.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const resizeObserver = new ResizeObserver(resize);
  resize();
  resizeObserver.observe(container);

  const frameListeners = new Set<FrameListener>();
  const addFrameListener = (listener: FrameListener) => {
    frameListeners.add(listener);
    return () => {
      frameListeners.delete(listener);
    };
  };

  // Eases the camera to a new position and target. Grabbing the view with the mouse cancels the move.
  let assistantPanelOffset: Vector3 | null = null;
  const ease = createCameraEase(camera, controls.target, addFrameListener, EASE_SECONDS);
  const { easeTo } = ease;
  controls.addEventListener("start", ease.stop);

  const zoomBy = (factor: number) => {
    if (!(factor > 0)) return;
    if (!fullNavigation) return;
    // From where an earlier step is heading, so quick steps add up instead of each starting half way.
    const rest = ease.restPose();
    const offset = rest.position.clone().sub(rest.target);
    const distance = MathUtils.clamp(
      offset.length() / factor,
      ORBIT_MIN_DISTANCE,
      ORBIT_MAX_DISTANCE,
    );
    easeTo(rest.target.clone().add(offset.setLength(distance)), rest.target);
  };
  const resetView = () => {
    if (!fullNavigation) return;
    const target = assistantPanelOffset?.clone() ?? new Vector3();
    easeTo(CAMERA_START.clone().add(target), target);
  };
  const setView = (preset: ViewPreset) => {
    if (!fullNavigation) return;
    ease.stop();
    const distance = Math.max(camera.position.distanceTo(controls.target), ORBIT_MIN_DISTANCE);
    camera.position.copy(viewPosition(controls.target, preset.direction, distance));
    controls.update();
  };
  const frameBox = (box: Box3) => {
    if (!fullNavigation || box.isEmpty()) return;
    const pose = framePose(box, { position: camera.position, target: controls.target }, camera.fov, camera.aspect, {
      minDistance: ORBIT_MIN_DISTANCE,
      maxDistance: ORBIT_MAX_DISTANCE,
    });
    // While the assistant panel is open the view is shifted to the free part of the screen; keep that shift.
    if (assistantPanelOffset) {
      pose.position.add(assistantPanelOffset);
      pose.target.add(assistantPanelOffset);
    }
    easeTo(pose.position, pose.target);
  };
  const setAssistantPanelOpen = (open: boolean) => {
    // The shift is added to where the view is heading, so opening and closing the panel within one ease cancel out.
    const rest = ease.restPose();
    if (open) {
      if (assistantPanelOffset) return;
      camera.updateMatrixWorld();
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const viewWidth =
        2 *
        rest.position.distanceTo(rest.target) *
        Math.tan(MathUtils.degToRad(camera.fov / 2)) *
        camera.aspect;
      assistantPanelOffset = right.multiplyScalar(
        -viewWidth * ASSISTANT_PANEL_SHIFT_FRACTION,
      );
      easeTo(
        rest.position.clone().add(assistantPanelOffset),
        rest.target.clone().add(assistantPanelOffset),
      );
      return;
    }
    if (!assistantPanelOffset) return;
    const restore = assistantPanelOffset.clone().negate();
    assistantPanelOffset = null;
    easeTo(rest.position.clone().add(restore), rest.target.clone().add(restore));
  };
  const setNavigationTool = (next: NavigationTool) => {
    tool = next;
    applyNavigation();
  };
  const setNavigationScope = (scope: NavigationScope) => {
    fullNavigation = scope === "full";
    if (!fullNavigation) {
      // A rotate-only view always starts from the default framing.
      ease.stop();
      camera.position.copy(CAMERA_START);
      controls.target.set(0, 0, 0);
      controls.update();
    }
    applyNavigation();
  };

  const timer = new Timer();
  timer.connect(document);
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const delta = timer.getDelta();
    controls.update(delta);
    frameListeners.forEach((listener) => listener(delta));
    shading.render(() => {
      if (outline.active) outline.render();
      else renderer.render(scene, camera);
    });
  });

  const dispose = () => {
    renderer.setAnimationLoop(null);
    timer.disconnect();
    resizeObserver.disconnect();
    ease.stop();
    disableSpacePan();
    outline.dispose();
    shading.dispose();
    controls.dispose();
    frameListeners.clear();

    scene.traverse((object) => {
      if (!hasGeometry(object)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    });

    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };

  return {
    scene,
    setShadingMode: (mode, xray) => shading.setMode(mode, xray),
    setShadingModelPredicate: (predicate) => shading.setModelPredicate(predicate),
    camera,
    renderer,
    controls,
    setNavigationTool,
    setEditNavigation: (enabled) => { controls.mouseButtons.RIGHT = enabled ? MOUSE.ROTATE : MOUSE.PAN; },
    setNavigationScope,
    zoomBy,
    resetView,
    frameBox,
    setView,
    setAssistantPanelOpen,
    addFrameListener,
    setOutlinedObjects: outline.setObjects,
    dispose,
  };
}
