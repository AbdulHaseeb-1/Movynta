import { knifeIsActive } from "./knifeActivity";
import type { EditorScene } from "@/features/assistant";
import { extrudeIsActive } from "@/features/objectEditing/ExtrudeGesture";
import { pickObjectId, toNdc } from "@/features/objectEditing/picking";
import { watchClicks } from "@/features/viewport3d/clicks";
import type { Viewport } from "@/features/viewport3d";

/** Switch the edit target when a different visible object is nearest to the click. */
export function watchEditObjectSelection(viewport: Viewport, scene: EditorScene): () => void {
  const dom = viewport.renderer.domElement;
  return watchClicks(dom, {
    capture: true,
    ignore: () => extrudeIsActive() || knifeIsActive(),
    onClick: (event) => {
      const bounds = dom.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const id = pickObjectId(scene, viewport.camera, toNdc(event.clientX, event.clientY, bounds));
      if (!id || id === scene.selection) return;
      event.preventDefault();
      scene.select(id);
    },
  });
}
