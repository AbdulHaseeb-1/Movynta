import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { createShadingRenderer, SOLID_XRAY_OPACITY } from "./shading";

describe("viewport shading", () => {
  it("restores model materials and leaves helpers untouched across modes", () => {
    const scene = new Scene();
    const original = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const model = new Mesh(new BoxGeometry(), original);
    const helper = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(model, helper);
    const render = vi.fn(() => { expect(helper.visible).toBe(false); });
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Rendering is exercised without a GPU.
    const renderer = { autoClear: true, render } as unknown as WebGLRenderer;
    const shading = createShadingRenderer(scene, renderer, new PerspectiveCamera());
    shading.setModelPredicate((object) => object === model);
    shading.setMode("wireframe", false);
    shading.render(() => {
      expect(helper.visible).toBe(true);
      expect(model.material).not.toBe(original);
      expect(renderer.autoClear).toBe(false);
    });
    expect(render).toHaveBeenCalledOnce();
    expect(model.material).toBe(original);
    expect(renderer.autoClear).toBe(true);
    shading.setMode("wireframe", true);
    shading.render(() => { expect(model.material).toHaveProperty("depthTest", false); });
    expect(render).toHaveBeenCalledOnce();
    shading.setMode("solid", false);
    expect(() => shading.render(() => { throw new Error("draw failed"); })).toThrow("draw failed");
    expect(model.material).toBe(original);
    expect(helper.visible).toBe(true);
    shading.dispose();
  });

  it("draws Solid see-through only while X-ray is on", () => {
    const scene = new Scene();
    const original = new MeshBasicMaterial();
    const model = new Mesh(new BoxGeometry(), original);
    scene.add(model);
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Rendering is exercised without a GPU.
    const renderer = { autoClear: true, render: vi.fn() } as unknown as WebGLRenderer;
    const shading = createShadingRenderer(scene, renderer, new PerspectiveCamera());
    shading.setModelPredicate((object) => object === model);
    shading.setMode("solid", false);
    shading.render(() => {
      expect(model.material).toMatchObject({ transparent: false, depthWrite: true });
    });
    shading.setMode("solid", true);
    shading.render(() => {
      expect(model.material).toMatchObject({ transparent: true, depthWrite: false, opacity: SOLID_XRAY_OPACITY });
    });
    expect(model.material).toBe(original);
    shading.setMode("default", true);
    shading.render(() => { expect(model.material).toBe(original); });
    shading.dispose();
  });
});
