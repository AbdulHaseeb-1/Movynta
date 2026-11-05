import {
  BufferGeometry,
  Color,
  Group,
  LineSegments,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Scene,
} from "three";
import type { Viewport } from "./viewport";

const GRID_SIZE = 400;
const GRID_DIVISIONS = 400;
const GRID_COLOR = 0x2a2a2a;
const HIGHLIGHT_COLOR = 0xa3a3a3;
const HIGHLIGHT_OPACITY = 0.35;
const FADE_NEAR = 8;
const FADE_FAR = 60;
const CROSS_SIZE = 10000;

// Lines fade out with distance from the camera, so the grid dissolves into the page instead of ending at an edge.
const fadeVertexShader = /* glsl */ `
  varying float vDistance;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vDistance = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fadeFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying float vDistance;

  void main() {
    float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDistance);
    gl_FragColor = vec4(uColor, uOpacity * fade);
    #include <colorspace_fragment>
  }
`;

function createFadeMaterial(color: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uFadeNear: { value: FADE_NEAR },
      uFadeFar: { value: FADE_FAR },
    },
    vertexShader: fadeVertexShader,
    fragmentShader: fadeFragmentShader,
    transparent: true,
    depthWrite: false,
  });
}

// Every grid line except the center pair, which is drawn separately as the highlight.
function createGridGeometry(size: number, divisions: number): BufferGeometry {
  const half = size / 2;
  const step = size / divisions;
  const center = divisions / 2;
  const points: Vector3[] = [];

  for (let i = 0; i <= divisions; i++) {
    if (i === center) continue;
    const offset = -half + i * step;
    points.push(new Vector3(-half, 0, offset), new Vector3(half, 0, offset));
    points.push(new Vector3(offset, 0, -half), new Vector3(offset, 0, half));
  }

  return new BufferGeometry().setFromPoints(points);
}

// The two highlighted lines through the origin, one along X and one along Z.
function createCrossGeometry(size: number): BufferGeometry {
  const half = size / 2;
  return new BufferGeometry().setFromPoints([
    new Vector3(-half, 0, 0),
    new Vector3(half, 0, 0),
    new Vector3(0, 0, -half),
    new Vector3(0, 0, half),
  ]);
}

// Adds the ground grid on the XZ plane, with two highlighted lines crossing at the origin.
export function addCoordinateSpace(scene: Scene): Group {
  const grid = new Group();
  grid.add(
    new LineSegments(
      createGridGeometry(GRID_SIZE, GRID_DIVISIONS),
      createFadeMaterial(GRID_COLOR, 1),
    ),
  );
  grid.add(
    new LineSegments(
      createCrossGeometry(CROSS_SIZE),
      createFadeMaterial(HIGHLIGHT_COLOR, HIGHLIGHT_OPACITY),
    ),
  );
  scene.add(grid);
  return grid;
}

/**
 * Keep the grid on world-unit multiples as the view moves. At distant zoom levels the same fixed
 * geometry represents larger intervals, so the grid stays useful without adding thousands of lines.
 */
export function updateCoordinateSpace(grid: Group, target: Vector3, distance: number): void {
  const lines = grid.children[0];
  if (!(lines instanceof LineSegments) || !(lines.material instanceof ShaderMaterial)) return;
  const scale = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(distance, 1) / 50)));
  lines.scale.set(scale, 1, scale);
  lines.position.set(Math.round(target.x / scale) * scale, 0, Math.round(target.z / scale) * scale);
  const fadeNear = Math.max(FADE_NEAR, distance * 0.8);
  const fadeFar = Math.max(FADE_FAR, distance * 3);
  for (const child of grid.children) {
    if (!(child instanceof LineSegments) || !(child.material instanceof ShaderMaterial)) continue;
    const material = child.material;
    const near = material.uniforms["uFadeNear"];
    const far = material.uniforms["uFadeFar"];
    if (near) near.value = fadeNear;
    if (far) far.value = fadeFar;
  }
}

const projected = new Vector3();

/** Screen position of the world origin, or null when it is behind the camera. Fractions run from the top left. */
export function originProjection(camera: Camera): { left: number; top: number } | null {
  camera.updateMatrixWorld();
  const viewZ = projected.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse).z;
  if (viewZ >= 0) return null;
  projected.set(0, 0, 0).project(camera);
  return { left: (projected.x + 1) / 2, top: (1 - projected.y) / 2 };
}

// Keeps `anchor` at the screen position of the origin, where the highlighted lines cross.
// Returns a function that stops the tracking.
export function anchorToOrigin(
  viewport: Viewport,
  anchor: HTMLElement,
): () => void {
  const { camera } = viewport;

  const place = () => {
    const projectedOrigin = originProjection(camera);
    if (!projectedOrigin) {
      anchor.style.visibility = "hidden";
      return;
    }
    anchor.style.visibility = "visible";
    anchor.style.left = `${projectedOrigin.left * 100}%`;
    anchor.style.top = `${projectedOrigin.top * 100}%`;
  };

  place();
  return viewport.addFrameListener(place);
}
