import { Color } from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";

/**
 * Sizes and colors a set of transform controls like every other in the workspace: the axes in the
 * theme's muted color and the active handle in its foreground color, drawn nowhere until shown.
 */
export function styleHandles(controls: TransformControls, size: number): void {
  controls.setSize(size);
  const theme = getComputedStyle(document.documentElement);
  const themeColor = (token: string) => new Color(theme.getPropertyValue(token).trim() || "white");
  controls.setColors(
    themeColor("--muted-foreground"),
    themeColor("--muted-foreground"),
    themeColor("--muted-foreground"),
    themeColor("--foreground"),
  );
  controls.getHelper().visible = false;
}
