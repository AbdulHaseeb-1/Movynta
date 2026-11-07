import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  type Vector2,
  type Camera,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { createOutlineRenderer } from "./outline";
describe("selection outline depth", () => {
  it("renders scene depth before the selected mask and restores renderer state", () => {
    const scene = new Scene(),
      selected = new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
      blocker = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    blocker.position.z = 1;
    scene.add(selected, blocker);
    scene.background = new Color("red");
    scene.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 5;
    camera.updateMatrixWorld(true);
    let target: WebGLRenderTarget | null = null,
      clearColor = new Color("blue"),
      alpha = 0.75;
    const calls: { scene: Scene; camera: Camera; material: unknown }[] = [];
    const fake = {
      autoClear: true,
      getRenderTarget: () => target,
      setRenderTarget: (value: WebGLRenderTarget | null) => {
        target = value;
      },
      getDrawingBufferSize: (v: Vector2) => v.set(800, 800),
      getPixelRatio: () => 1,
      getClearColor: (value: Color) => value.copy(clearColor),
      getClearAlpha: () => alpha,
      setClearColor: (value: Color | number, nextAlpha: number) => {
        clearColor = new Color(value);
        alpha = nextAlpha;
      },
      clear: () => undefined,
      render: (value: Scene, view: Camera) =>
        calls.push({
          scene: value,
          camera: view,
          material: value.overrideMaterial,
        }),
      setScissorTest: () => undefined,
      setScissor: () => undefined,
    };
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Renderer fixture records calls without a GPU.
    const renderer = fake as unknown as WebGLRenderer;
    const outline = createOutlineRenderer(renderer, scene, camera);
    outline.setObjects([selected]);
    outline.render();
    expect(calls).toHaveLength(4);
    expect(calls[1]?.material).toMatchObject({
      colorWrite: false,
      depthWrite: true,
    });
    expect(calls[2]?.material).toMatchObject({
      colorWrite: true,
      depthWrite: true,
    });
    expect(fake.autoClear).toBe(true);
    expect(clearColor.getHexString()).toBe("0000ff");
    expect(alpha).toBe(0.75);
    expect(scene.background).toEqual(new Color("red"));
    expect(camera.layers.mask).toBe(1);
    outline.dispose();
  });
});
