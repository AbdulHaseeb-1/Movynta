/*
 * BENCH: Viewport render cost with and without a selection outline
 * TIER: HIGH
 * SUBJECT: apps/desktop/src/features/viewport3d/outline.ts#createOutlineRenderer, against the plain renderer.render
 * MEASURES: latency (GPU-inclusive, ms per frame)
 * COMPLEXITY: declared O(triangles) + O(pixels) per frame; the outline must not add a multiple of either
 * INPUTS: 1k, 10k, 100k, 400k triangles in one selected mesh, 1280x960 backing store; seed-free (a fixed icosphere)
 * BASELINE: baselines/viewport/render.baseline.json
 * THRESHOLD: outline overhead above 25% of the plain frame time, or p95 above 1.5x the median, fails the budget
 * EXCLUDES: scene construction, shader compilation (warmup), canvas presentation
 * NOTES: A real GPU is needed for absolute numbers. Run in the app's browser pane, where only the ratios between
 *        variants are meaningful. Each frame ends with a 1-pixel readPixels, which forces the GPU to finish.
 *
 * Run (browser, with `pnpm --filter movynta-desktop dev` serving on :1420):
 *   const m = await import("/@fs/<repo>/benchmarks/suites/viewport/render.browser.ts");
 *   JSON.stringify(await m.runRenderBenchmark());
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HalfFloatType,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Object3D,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { createOutlineRenderer } from "../../../apps/desktop/src/features/viewport3d/outline";

/**
 * The first implementation, kept here as the reference the shipped one is compared against: the whole
 * scene is re-rendered through a multisampled half-float composer with OutlinePass and OutputPass.
 */
function createLegacyComposerOutline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  selected: Object3D,
) {
  const target = new WebGLRenderTarget(WIDTH, HEIGHT, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(WIDTH, HEIGHT);
  composer.addPass(new RenderPass(scene, camera));
  const outline = new OutlinePass(new Vector2(WIDTH, HEIGHT), scene, camera, [selected]);
  outline.visibleEdgeColor.copy(new Color("#ff9b21"));
  outline.edgeStrength = 6;
  outline.edgeThickness = 1.6;
  outline.pulsePeriod = 0;
  composer.addPass(outline);
  composer.addPass(new OutputPass());
  return {
    render: () => composer.render(0.016),
    dispose: () => {
      composer.dispose();
      outline.dispose();
    },
  };
}

export interface FrameStats {
  median: number;
  p95: number;
  p99: number;
  mean: number;
  samples: number;
}

export interface VariantResult {
  variant: string;
  triangles: number;
  stats: FrameStats;
}

interface Variant {
  name: string;
  /** Builds the renderer for one frame loop; `render` draws one frame. */
  create: (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, selected: Object3D) => {
    render: () => void;
    dispose: () => void;
  };
}

const WIDTH = 1024;
const HEIGHT = 768;
const PIXEL_RATIO = 1.25;
const WARMUP_FRAMES = 8;
const MEASURED_FRAMES = 60;

/** Triangle counts of an icosphere are 20 * (detail + 1)^2. */
const DETAIL_FOR: Readonly<Record<number, number>> = { 1000: 6, 10000: 21, 100000: 70, 400000: 140 };

export const variants: Variant[] = [
  {
    name: "plain",
    create: (renderer, scene, camera) => ({
      render: () => renderer.render(scene, camera),
      dispose: () => undefined,
    }),
  },
  {
    name: "outline (first version: composer)",
    create: (renderer, scene, camera, selected) =>
      createLegacyComposerOutline(renderer, scene, camera, selected),
  },
  {
    name: "outline (shipped)",
    create: (renderer, scene, camera, selected) => {
      const outline = createOutlineRenderer(renderer, scene, camera);
      outline.setSize(WIDTH, HEIGHT);
      outline.setObjects([selected]);
      return { render: () => outline.render(), dispose: () => outline.dispose() };
    },
  },
];

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

function summarize(times: number[]): FrameStats {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((total, value) => total + value, 0);
  const round = (value: number) => Number(value.toFixed(2));
  return {
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    mean: round(sum / times.length),
    samples: times.length,
  };
}

function buildScene(triangles: number) {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 0.6));
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(3, 5, 4);
  scene.add(light);
  const mesh = new Mesh(
    new IcosahedronGeometry(1, DETAIL_FOR[triangles] ?? 21),
    new MeshStandardMaterial({ color: "#b6aaa4", roughness: 0.65 }),
  );
  scene.add(mesh);
  const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
  camera.position.set(2.5, 2, 3.5);
  camera.lookAt(0, 0, 0);
  return { scene, camera, mesh };
}

/** Renders one frame and waits for the GPU to finish it with a one-pixel read. Returns the time in ms. */
function timeFrame(gl: WebGLRenderingContext | WebGL2RenderingContext, render: () => void, sink: Uint8Array): number {
  const start = performance.now();
  render();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sink);
  return performance.now() - start;
}

export async function runRenderBenchmark(
  sizes: readonly number[] = [1000, 10000, 100000],
  selected: readonly string[] = variants.map((variant) => variant.name),
): Promise<VariantResult[]> {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(PIXEL_RATIO);
  renderer.setSize(WIDTH, HEIGHT, false);
  const gl = renderer.getContext();
  const sink = new Uint8Array(4);
  const results: VariantResult[] = [];
  for (const triangles of sizes) {
    // Every variant gets its own copy of the scene, and frames alternate between them, so slow drift in
    // the machine's load lands on all variants equally instead of favoring the one that ran last.
    const cases = variants
      .filter((item) => selected.includes(item.name))
      .map((variant) => {
        const { scene, camera, mesh } = buildScene(triangles);
        return { variant, mesh, frame: variant.create(renderer, scene, camera, mesh), times: [] as number[] };
      });
    for (let warmup = 0; warmup < WARMUP_FRAMES; warmup += 1)
      for (const item of cases) timeFrame(gl, item.frame.render, sink);
    for (let measured = 0; measured < MEASURED_FRAMES; measured += 1)
      for (const item of cases) item.times.push(timeFrame(gl, item.frame.render, sink));
    for (const item of cases) {
      results.push({ variant: item.variant.name, triangles, stats: summarize(item.times) });
      item.frame.dispose();
      item.mesh.geometry.dispose();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // The pixel feeds a sink, so the reads cannot be treated as dead.
  if (sink[3] === 256) throw new Error("unreachable");
  renderer.dispose();
  return results;
}
