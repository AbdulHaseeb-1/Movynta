import {
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  type Mesh,
  MeshNormalMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Object3D,
} from "three";
import {
  MAX_IMAGE_BASE64_LENGTH,
  MAX_LISTED_OBJECTS,
  type CapturedImage,
  type CapturedObject,
  type ViewCaptureRequest,
  type ViewCaptureResult,
  type ViewSpec,
} from "@movynta/editor-protocol";
import type { Viewport } from "@/features/viewport3d";
import { captureNear, frameView, guidePlacement, subjectOf, type CameraPose, type Subject } from "./framing";
import { drawOverlay, type OverlayItem } from "./overlay";
import { isInFrame, projectBounds } from "./screenBounds";
import type { CaptureOptions, CaptureScene } from "./types";
import { isMesh } from "@/lib/three";

const DEFAULT_WIDTH = 768;
const DEFAULT_HEIGHT = 576;
const BACKGROUND = "#23262d";
const JPEG_QUALITIES = [0.85, 0.65, 0.45];
const JPEG_PREFIX = "data:image/jpeg;base64,";
const MSAA_SAMPLES = 4;
const HEADLIGHT_INTENSITY = 1.4;
const GRID_COLORS = [0x6b7280, 0x3b4048] as const;

interface Entry {
  id: string;
  object: Object3D;
}


function isLight(node: Object3D): boolean {
  return "isLight" in node && node.isLight === true;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toArray(vector: Vector3): number[] {
  return [round(vector.x), round(vector.y), round(vector.z)];
}

/** The box around an object and everything below it, or a point where it stands if it has no shape. */
function boundsOf(object: Object3D): Box3 {
  const box = new Box3().setFromObject(object);
  if (!box.isEmpty()) return box;
  const place = object.getWorldPosition(new Vector3());
  return new Box3(place.clone(), place.clone());
}

function union(boxes: readonly Box3[]): Box3 | null {
  const first = boxes[0];
  if (!first) return null;
  const all = first.clone();
  for (const box of boxes) all.union(box);
  return all;
}

function hasTrackedAncestor(scene: CaptureScene, object: Object3D): boolean {
  for (let above = object.parent; above; above = above.parent) if (scene.idOf(above) !== undefined) return true;
  return false;
}

/** Looks up ids, once each, noting the ones the scene does not have. */
function resolve(ids: readonly string[] | undefined, scene: CaptureScene, missing: string[]): Entry[] {
  const found: Entry[] = [];
  const seen = new Set<string>();
  for (const id of ids ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const object = scene.getObject(id);
    if (object) found.push({ id, object });
    else if (!missing.includes(id)) missing.push(id);
  }
  return found;
}

function boundsJson(box: Box3) {
  return { min: toArray(box.min), max: toArray(box.max) };
}

function viewLabel(spec: ViewSpec, index: number): string {
  if (spec.label) return spec.label;
  if (spec.camera) return "custom camera";
  if (spec.orbit) return `orbit ${spec.orbit.azimuthDegrees}/${spec.orbit.elevationDegrees}`;
  return spec.preset ?? (index === 0 ? "isometric" : `view ${index + 1}`);
}

function buildCamera(pose: CameraPose, aspect: number, reach: number): PerspectiveCamera | OrthographicCamera {
  const distance = pose.position.distanceTo(pose.target);
  const far = distance + reach * 4 + 100;
  const camera =
    pose.projection === "orthographic"
      ? new OrthographicCamera(
          (-pose.orthographicHeight * aspect) / 2,
          (pose.orthographicHeight * aspect) / 2,
          pose.orthographicHeight / 2,
          -pose.orthographicHeight / 2,
          captureNear(distance),
          far,
        )
      : new PerspectiveCamera(pose.fov, aspect, captureNear(distance), far);
  camera.position.copy(pose.position);
  camera.up.copy(pose.up);
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/** Turns what the render target holds (bottom row first) into a JPEG with the overlay drawn on it. */
function encode(pixels: Uint8Array, width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This editor cannot make 2D images");
  const image = context.createImageData(width, height);
  const rowLength = width * 4;
  for (let row = 0; row < height; row += 1) {
    const from = (height - 1 - row) * rowLength;
    image.data.set(pixels.subarray(from, from + rowLength), row * rowLength);
  }
  context.putImageData(image, 0, 0);
  draw(context);
  for (const quality of JPEG_QUALITIES) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (!url.startsWith(JPEG_PREFIX)) throw new Error("This editor cannot make JPEG images");
    const data = url.slice(JPEG_PREFIX.length);
    if (data.length <= MAX_IMAGE_BASE64_LENGTH) return data;
  }
  throw new Error("The picture is too detailed to send; ask for a smaller width and height");
}

/** Collects what has to be put back after a capture, so the editor looks exactly as it did before. */
class Restorer {
  private readonly steps: (() => void)[] = [];

  add(step: () => void): void {
    this.steps.push(step);
  }

  hide(object: Object3D): void {
    if (!object.visible) return;
    object.visible = false;
    this.add(() => {
      object.visible = true;
    });
  }

  show(object: Object3D): void {
    if (object.visible) return;
    object.visible = true;
    this.add(() => {
      object.visible = false;
    });
  }

  restore(): void {
    for (const step of this.steps.reverse()) step();
    this.steps.length = 0;
  }
}

function materialsOf(mesh: Mesh): Material[] {
  const material = mesh.material;
  return Array.isArray(material) ? material : [material];
}

/** Draws the meshes as lines (wireframe) or by surface direction (normals) until `restorer` runs. */
function applyMode(scene: Viewport["scene"], mode: "solid" | "wireframe" | "normals", restorer: Restorer): void {
  if (mode === "solid") return;
  const meshes: Mesh[] = [];
  scene.traverseVisible((node) => {
    if (isMesh(node)) meshes.push(node);
  });
  if (mode === "normals") {
    const normals = new MeshNormalMaterial({ side: DoubleSide });
    restorer.add(() => normals.dispose());
    for (const mesh of meshes) {
      const original = mesh.material;
      mesh.material = normals;
      restorer.add(() => {
        mesh.material = original;
      });
    }
    return;
  }
  const materials = new Set<Material>();
  for (const mesh of meshes) for (const material of materialsOf(mesh)) materials.add(material);
  for (const material of materials) {
    if (!("wireframe" in material) || typeof material.wireframe !== "boolean") continue;
    const before = material.wireframe;
    material.wireframe = true;
    restorer.add(() => {
      material.wireframe = before;
    });
  }
}

/** Adds a light the capture moves to each camera, removed again when `restorer` runs. */
function addHeadlight(scene: Viewport["scene"], restorer: Restorer): DirectionalLight {
  const headlight = new DirectionalLight(0xffffff, HEADLIGHT_INTENSITY);
  scene.add(headlight, headlight.target);
  restorer.add(() => {
    scene.remove(headlight, headlight.target);
    headlight.dispose();
  });
  return headlight;
}

/** A floor grid and axes for scale, placed on the framed subject, removed again when `restorer` runs. */
function addGuides(scene: Viewport["scene"], framed: Subject, restorer: Restorer): void {
  const placement = guidePlacement(framed);
  const size = Math.max(Math.ceil(placement.size), 2);
  const grid = new GridHelper(size, Math.min(Math.max(Math.round(size), 2), 40), GRID_COLORS[0], GRID_COLORS[1]);
  const axes = new AxesHelper(placement.axisLength);
  grid.position.copy(placement.floor);
  axes.position.copy(placement.origin);
  scene.add(grid, axes);
  restorer.add(() => {
    scene.remove(grid, axes);
    grid.dispose();
    axes.dispose();
  });
}

/**
 * Draws the editor scene from the points of view in `request`, offscreen, and reports where everything is.
 * The visible viewport is not touched: the scene is changed only for the moment of drawing (a different
 * background, helpers hidden, a light added) and put back before this returns, even if drawing fails.
 */
export function captureViews(viewport: Viewport, editor: CaptureScene, request: ViewCaptureRequest, options: CaptureOptions): ViewCaptureResult {
  const { scene, renderer } = viewport;
  const width = request.width ?? DEFAULT_WIDTH;
  const height = request.height ?? DEFAULT_HEIGHT;
  const aspect = width / height;
  const mode = request.mode ?? "solid";
  scene.updateMatrixWorld(true);

  const registered = [...editor.entries()];
  const missingIds: string[] = [];
  const focus = resolve(request.focus, editor, missingIds);
  const highlight = resolve(request.highlight, editor, missingIds);
  const highlighted = new Set(highlight.map((entry) => entry.id));

  const sceneBox = union(registered.filter(([, object]) => !hasTrackedAncestor(editor, object)).map(([, object]) => boundsOf(object)));
  const boundsById = new Map<string, Box3>();
  const boundsFor = (entry: Entry): Box3 => {
    const known = boundsById.get(entry.id);
    if (known) return known;
    const box = boundsOf(entry.object);
    boundsById.set(entry.id, box);
    return box;
  };
  const focusBox = focus.length > 0 ? union(focus.map(boundsFor)) : sceneBox;
  const subject: Subject = subjectOf(focusBox);
  const sceneSubject = subjectOf(sceneBox);

  const listed: Entry[] = focus.length > 0 ? [...focus] : registered.slice(0, MAX_LISTED_OBJECTS).map(([id, object]) => ({ id, object }));
  for (const entry of highlight) if (!listed.some((item) => item.id === entry.id) && listed.length < MAX_LISTED_OBJECTS) listed.push(entry);

  const current = {
    position: viewport.camera.position.clone(),
    target: viewport.controls.target.clone(),
    fov: viewport.camera.fov,
  };

  const restorer = new Restorer();
  const previousTarget = renderer.getRenderTarget();
  const target = options.withImages ? new WebGLRenderTarget(width, height, { samples: MSAA_SAMPLES, colorSpace: SRGBColorSpace }) : undefined;
  const images: CapturedImage[] = [];

  try {
    if (options.withImages) {
      // Anything in the scene that is not an object the assistant can name (handles, markers) stays out of the picture.
      for (const child of scene.children) if (!isLight(child) && editor.idOf(child) === undefined) restorer.hide(child);
      if (request.isolate && focus.length > 0) {
        const keep = new Set<Object3D>();
        for (const { object } of focus) {
          object.traverse((node) => keep.add(node));
          for (let above = object.parent; above; above = above.parent) keep.add(above);
        }
        for (const [, object] of registered) if (!keep.has(object)) restorer.hide(object);
      }
      // What the assistant asked to look at is shown even if the user hid it.
      for (const { object } of focus) for (let node: Object3D | null = object; node; node = node.parent) restorer.show(node);
      applyMode(scene, mode, restorer);
      if (request.guides !== false) addGuides(scene, subject, restorer);

      const previousBackground = scene.background;
      scene.background = new Color(BACKGROUND);
      restorer.add(() => {
        scene.background = previousBackground;
      });
    }
    // A light that follows the camera, so a view from behind is lit as well as one from the front.
    const headlight = target ? addHeadlight(scene, restorer) : undefined;

    request.views.forEach((spec, index) => {
      const pose = frameView(spec, subject, aspect, current);
      const camera = buildCamera(pose, aspect, sceneSubject.radius);
      const label = viewLabel(spec, index);

      const items: OverlayItem[] = listed.map((entry) => ({
        id: entry.id,
        rect: projectBounds(boundsFor(entry), camera, width, height),
        highlighted: highlighted.has(entry.id),
      }));
      const objects: CapturedObject[] = listed.map((entry, position) => {
        const rect = items[position]?.rect ?? null;
        return { id: entry.id, name: entry.object.name, screenBounds: rect, inFrame: isInFrame(rect, width, height) };
      });

      let data = "";
      if (target && headlight) {
        headlight.position.copy(pose.position);
        headlight.target.position.copy(pose.target);
        headlight.target.updateMatrixWorld(true);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        const caption = [label, pose.projection, ...(mode === "solid" ? [] : [mode])].join(" | ");
        data = encode(pixels, width, height, (context) => drawOverlay(context, width, height, { items, labels: request.labels !== false, caption }));
      }

      images.push({
        label,
        mediaType: "image/jpeg",
        data,
        width,
        height,
        camera: {
          projection: pose.projection,
          position: toArray(pose.position),
          target: toArray(pose.target),
          fov: pose.projection === "perspective" ? round(pose.fov) : null,
          orthographicHeight: pose.projection === "orthographic" ? round(pose.orthographicHeight) : null,
        },
        objects,
      });
    });
  } finally {
    renderer.setRenderTarget(previousTarget);
    restorer.restore();
    target?.dispose();
  }

  return {
    images,
    scene: { objectCount: registered.length, bounds: sceneBox ? boundsJson(sceneBox) : null },
    focus: focus.map((entry) => {
      const box = boundsFor(entry);
      return {
        id: entry.id,
        name: entry.object.name,
        bounds: boundsJson(box),
        size: toArray(box.getSize(new Vector3())),
        center: toArray(box.getCenter(new Vector3())),
      };
    }),
    missingIds,
  };
}
