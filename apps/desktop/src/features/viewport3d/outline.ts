import {
  Box3,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from "three";

/**
 * The outline of a selection, as in Blender: bright orange around the silhouette. Three.js shader code
 * needs literal colors, so the color lives here, in sRGB because the canvas is written directly.
 */
const OUTLINE_COLOR = [1.0, 0.608, 0.129] as const;
/** The thickness of the line in device pixels at the default pixel ratio of 1. */
const THICKNESS_PIXELS = 1.25;
/** The mask is drawn at this fraction of the canvas size, which is all an outline needs. */
const MASK_SCALE = 0.85;
/** Objects take part in the outline by being on this camera layer; the main pass ignores layers. */
const SELECTION_LAYER = 1;
const RING_SAMPLES = 12;
/** Extra pixels around the object that the outline may reach into, besides the line's own thickness. */
const SCISSOR_MARGIN_PIXELS = 4;
/** Above this share of the screen a rectangle saves little, so the whole screen is used. */
const SCISSOR_MAX_COVERAGE = 0.8;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Draws only pixels just outside the mask: it looks around each one in a ring and takes the strongest
 * coverage it finds, so the line follows the silhouette and fades smoothly at both edges.
 */
const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uTexel;
  uniform float uRadius;
  uniform vec3 uColor;
  varying vec2 vUv;
  const int SAMPLES = ${RING_SAMPLES};
  const float TAU = 6.28318530718;

  void main() {
    float inside = texture2D(uMask, vUv).a;
    if (inside > 0.999) discard;
    float strongest = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float angle = TAU * float(i) / float(SAMPLES);
      vec2 direction = vec2(cos(angle), sin(angle)) * uTexel;
      strongest = max(strongest, texture2D(uMask, vUv + direction * uRadius).a);
      strongest = max(strongest, texture2D(uMask, vUv + direction * uRadius * 0.5).a);
    }
    float alpha = clamp(strongest * 1.4, 0.0, 1.0) * (1.0 - inside);
    if (alpha <= 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export interface OutlineRenderer {
  /** The objects to outline. An empty list switches the outline, and its cost, off. */
  setObjects: (objects: readonly Object3D[]) => void;
  readonly active: boolean;
  /** Renders the scene, then the outline over it. Use instead of the plain render while active. */
  render: () => void;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
}

/** The corners of a box, for projecting it to the screen. */
function cornersOf(box: Box3, into: Vector3[]) {
  const { min, max } = box;
  let index = 0;
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) into[index++]?.set(x, y, z);
}

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function setLayer(root: Object3D, on: boolean) {
  root.traverse((node) => {
    if (on) node.layers.enable(SELECTION_LAYER);
    else node.layers.disable(SELECTION_LAYER);
  });
}

/** Whether any part of an object is deformed by a skeleton. */
function containsSkinnedMesh(object: Object3D): boolean {
  let found = false;
  object.traverse((node) => {
    if ("isSkinnedMesh" in node) found = true;
  });
  return found;
}

/**
 * Outlines chosen objects without touching how the scene itself is drawn. The scene renders exactly as
 * it does without a selection; the outline is a second, small job on top: the chosen objects alone
 * are drawn white into a half-size mask, and a thin edge shader paints the ring around that mask. The
 * extra cost follows the selected object, not the scene, and no full-size intermediate image is made.
 */
export function createOutlineRenderer(renderer: WebGLRenderer, scene: Scene, camera: Camera): OutlineRenderer {
  let targets: readonly Object3D[] = [];
  /** Each target's box in its own space, taken once, so a frame never walks the object's parts. */
  let localBoxes: Box3[] = [];
  const corners = Array.from({ length: 8 }, () => new Vector3());
  const mask = new WebGLRenderTarget(1, 1, { depthBuffer: true });
  const maskMaterial = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
  const occluderMaterial = new MeshBasicMaterial({
    colorWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  // Held directly, so a frame can update them without looking them up by name.
  const texel = { value: new Vector2(1, 1) };
  const radius = { value: THICKNESS_PIXELS };
  const edgeMaterial = new ShaderMaterial({
    uniforms: {
      uMask: { value: mask.texture },
      uTexel: texel,
      uRadius: radius,
      uColor: { value: OUTLINE_COLOR },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), edgeMaterial);
  quad.frustumCulled = false;
  const overlay = new Scene();
  overlay.add(quad);
  const overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new Vector2();

  const resizeMask = () => {
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.round(size.x * MASK_SCALE));
    const height = Math.max(1, Math.round(size.y * MASK_SCALE));
    if (mask.width !== width || mask.height !== height) mask.setSize(width, height);
    texel.value.set(1 / width, 1 / height);
    // The line keeps its thickness in device pixels whatever the pixel ratio and the mask scale.
    radius.value = Math.max(1, THICKNESS_PIXELS * renderer.getPixelRatio() * MASK_SCALE);
  };

  /**
   * The part of the screen the selection can reach, in drawing-buffer pixels, or undefined when it
   * covers most of the screen, reaches behind the camera, or cannot be told. Everything the outline
   * draws is limited to it, so a small object costs little however large the window is.
   */
  const screenRect = (): PixelRect | undefined => {
    renderer.getDrawingBufferSize(size);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [index, object] of targets.entries()) {
      const box = localBoxes[index];
      if (!box || box.isEmpty()) return undefined;
      object.updateWorldMatrix(true, false);
      cornersOf(box, corners);
      for (const corner of corners) {
        corner.applyMatrix4(object.matrixWorld);
        // A point at or behind the camera has no place on the screen.
        const depth = corner.clone().applyMatrix4(camera.matrixWorldInverse).z;
        if (depth >= 0) return undefined;
        corner.project(camera);
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y);
        maxY = Math.max(maxY, corner.y);
      }
    }
    const margin = SCISSOR_MARGIN_PIXELS + THICKNESS_PIXELS * renderer.getPixelRatio() * 2;
    const x = Math.max(0, Math.floor(((minX + 1) / 2) * size.x - margin));
    const y = Math.max(0, Math.floor(((minY + 1) / 2) * size.y - margin));
    const right = Math.min(size.x, Math.ceil(((maxX + 1) / 2) * size.x + margin));
    const top = Math.min(size.y, Math.ceil(((maxY + 1) / 2) * size.y + margin));
    const width = right - x;
    const height = top - y;
    if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 1, height: 1 };
    if ((width * height) / (size.x * size.y) > SCISSOR_MAX_COVERAGE) return undefined;
    return { x, y, width, height };
  };

  const drawMask = (rect: PixelRect | undefined) => {
    const previousTarget = renderer.getRenderTarget();
    const previousLayers = camera.layers.mask;
    const previousOverride = scene.overrideMaterial;
    const previousBackground = scene.background;
    const clearColor = renderer.getClearColor(new Color()).clone();
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(mask);
      mask.scissorTest = rect !== undefined;
      if (rect)
        mask.scissor.set(
          Math.floor(rect.x * MASK_SCALE),
          Math.floor(rect.y * MASK_SCALE),
          Math.ceil(rect.width * MASK_SCALE),
          Math.ceil(rect.height * MASK_SCALE),
        );
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.autoClear = false;
      scene.background = null;
      // Populate depth with all visible scene geometry before drawing selected pixels.
      scene.overrideMaterial = occluderMaterial;
      renderer.render(scene, camera);
      camera.layers.set(SELECTION_LAYER);
      scene.overrideMaterial = maskMaterial;
      renderer.render(scene, camera);
    } finally {
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      camera.layers.mask = previousLayers;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.autoClear = autoClear;
    }
  };

  return {
    setObjects(objects) {
      for (const previous of targets) setLayer(previous, false);
      targets = objects;
      for (const next of targets) setLayer(next, true);
      localBoxes = targets.map((object) => {
        // A skinned mesh reaches wherever its bones take it, which no box measured now can promise, so
        // it gets an empty one: the outline then covers the whole view instead of a part that could clip it.
        if (containsSkinnedMesh(object)) return new Box3();
        object.updateWorldMatrix(true, true);
        // Measured in the object's own space: the box then stays right as the object moves.
        return new Box3().setFromObject(object).applyMatrix4(object.matrixWorld.clone().invert());
      });
    },
    get active() {
      return targets.length > 0;
    },
    render() {
      renderer.render(scene, camera);
      resizeMask();
      const rect = screenRect();
      drawMask(rect);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      if (rect) {
        // setScissor works in layout pixels, not device pixels.
        const ratio = renderer.getPixelRatio();
        renderer.setScissorTest(true);
        renderer.setScissor(rect.x / ratio, rect.y / ratio, rect.width / ratio, rect.height / ratio);
      }
      renderer.render(overlay, overlayCamera);
      renderer.setScissorTest(false);
      renderer.autoClear = autoClear;
    },
    setSize() {
      // The mask follows the drawing buffer, which is read when each frame is drawn.
    },
    dispose() {
      for (const previous of targets) setLayer(previous, false);
      targets = [];
      mask.dispose();
      maskMaterial.dispose();
      occluderMaterial.dispose();
      edgeMaterial.dispose();
      quad.geometry.dispose();
    },
  };
}
