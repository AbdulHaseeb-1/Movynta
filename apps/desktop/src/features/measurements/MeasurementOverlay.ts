import { Vector2, Vector3 } from "three";
import type { MeasurementAnnotation } from "@movynta/editor-protocol";
import type { Viewport } from "@/features/viewport3d";

interface Drawing {
  path: string;
  anchor: Vector2;
}

function dimensionPath(points: readonly Vector2[]): Drawing | null {
  const [a, b] = points;
  if (!a || !b) return null;
  const normal = new Vector2(-(b.y - a.y), b.x - a.x).normalize();
  if (normal.y > 0) normal.negate();
  const start = a.clone().addScaledVector(normal, 20);
  const end = b.clone().addScaledVector(normal, 20);
  const segment = (from: Vector2, to: Vector2) => "M " + from.x + " " + from.y + " L " + to.x + " " + to.y;
  return {
    path: [
      segment(a, a.clone().addScaledVector(normal, 27)),
      segment(b, b.clone().addScaledVector(normal, 27)),
      segment(start, end),
      segment(start.clone().addScaledVector(normal, -4), start.clone().addScaledVector(normal, 4)),
      segment(end.clone().addScaledVector(normal, -4), end.clone().addScaledVector(normal, 4)),
    ].join(" "),
    anchor: start.clone().add(end).multiplyScalar(0.5),
  };
}

function angleArc(points: readonly number[][]): Vector3[] {
  const [a, b, c] = points;
  if (!a || !b || !c) return [];
  const center = new Vector3().fromArray(b);
  const first = new Vector3().fromArray(a).sub(center);
  const second = new Vector3().fromArray(c).sub(center);
  const radius = Math.min(first.length(), second.length()) * 0.25;
  if (radius === 0) return [];
  first.normalize();
  second.normalize();
  const angle = first.angleTo(second);
  const axis = first.clone().cross(second);
  if (axis.lengthSq() < 1e-12)
    axis.crossVectors(first, Math.abs(first.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
  axis.normalize();
  return Array.from({ length: 17 }, (_, i) =>
    first
      .clone()
      .applyAxisAngle(axis, (angle * i) / 16)
      .multiplyScalar(radius)
      .add(center),
  );
}

/** Dimension lines and true 3D angle arcs remain attached to their world points as the camera moves. */
export class MeasurementOverlay {
  private readonly element: SVGSVGElement;
  private readonly stop: () => void;

  constructor(
    viewport: Viewport,
    annotations: readonly MeasurementAnnotation[],
    label: (annotation: MeasurementAnnotation) => string,
  ) {
    const ns = "http://www.w3.org/2000/svg";
    this.element = document.createElementNS(ns, "svg");
    this.element.setAttribute("aria-hidden", "true");
    this.element.setAttribute(
      "class",
      "pointer-events-none absolute inset-0 h-full w-full overflow-hidden text-foreground",
    );
    const rows = annotations.map((annotation) => {
      const group = document.createElementNS(ns, "g");
      const title = document.createElementNS(ns, "title");
      title.textContent = annotation.name;
      const halo = document.createElementNS(ns, "path");
      halo.setAttribute("fill", "none");
      halo.setAttribute("stroke", "var(--background)");
      halo.setAttribute("stroke-width", "3.5");
      halo.setAttribute("stroke-opacity", "0.7");
      const line = document.createElementNS(ns, "path");
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", "1");
      if (annotation.id === "pending") line.setAttribute("stroke-dasharray", "3 3");
      const badge = document.createElementNS(ns, "g");
      const background = document.createElementNS(ns, "rect");
      background.setAttribute("rx", "4");
      background.setAttribute("height", "23");
      background.setAttribute("fill", "var(--popover)");
      background.setAttribute("stroke", "var(--border)");
      const text = document.createElementNS(ns, "text");
      text.setAttribute("fill", "currentColor");
      text.setAttribute("font-size", "11");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("class", "font-mono tabular-nums");
      text.textContent = label(annotation);
      badge.append(background, text);
      const dots = annotation.points.map(() => {
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("r", "2.5");
        dot.setAttribute("fill", "var(--popover)");
        dot.setAttribute("stroke", "currentColor");
        dot.setAttribute("stroke-width", "1.5");
        return dot;
      });
      group.append(title, halo, line, ...dots, badge);
      this.element.append(group);
      return {
        annotation,
        group,
        halo,
        line,
        badge,
        background,
        text,
        dots,
        arc: angleArc(annotation.points),
        width: 0,
      };
    });
    viewport.renderer.domElement.parentElement?.append(this.element);
    for (const row of rows) {
      row.width = Math.max(48, row.text.getComputedTextLength() + 16);
      row.background.setAttribute("width", String(row.width));
    }
    const position = new Vector3();
    const project = (point: Vector3, width: number, height: number) => {
      position.copy(point).project(viewport.camera);
      return new Vector2(((position.x + 1) * width) / 2, ((1 - position.y) * height) / 2);
    };
    const update = () => {
      const dom = viewport.renderer.domElement;
      const width = dom.clientWidth,
        height = dom.clientHeight;
      viewport.camera.updateMatrixWorld();
      for (const row of rows) {
        let visible = true;
        const projected = row.annotation.points.map((point) => {
          const world = new Vector3().fromArray(point);
          const screen = project(world, width, height);
          visible &&= position.z >= -1 && position.z <= 1;
          return screen;
        });
        row.group.style.display = visible ? "" : "none";
        if (!visible) continue;
        let drawing = dimensionPath(projected);
        if (row.annotation.id === "pending" && row.annotation.name === "Angle" && projected.length === 2) {
          drawing = {
            path: "M " + projected.map((point) => point.x + " " + point.y).join(" L "),
            anchor: projected[1]?.clone() ?? new Vector2(),
          };
        }
        if (row.arc.length && projected.length === 3) {
          const arc = row.arc.map((point) => project(point, width, height));
          const path =
            "M " +
            projected.map((point) => point.x + " " + point.y).join(" L ") +
            " M " +
            arc.map((point) => point.x + " " + point.y).join(" L ");
          drawing = { path, anchor: arc[8]?.clone() ?? projected[1]?.clone() ?? new Vector2() };
        }
        row.line.setAttribute("d", drawing?.path ?? "");
        row.halo.setAttribute("d", drawing?.path ?? "");
        projected.forEach((point, i) => {
          row.dots[i]?.setAttribute("cx", String(point.x));
          row.dots[i]?.setAttribute("cy", String(point.y));
        });
        row.badge.style.display = drawing && row.text.textContent ? "" : "none";
        if (!drawing) continue;
        const x = Math.max(row.width / 2 + 8, Math.min(width - row.width / 2 - 8, drawing.anchor.x));
        const y = Math.max(20, Math.min(height - 20, drawing.anchor.y));
        row.background.setAttribute("x", String(x - row.width / 2));
        row.background.setAttribute("y", String(y - 11.5));
        row.text.setAttribute("x", String(x));
        row.text.setAttribute("y", String(y));
      }
    };
    update();
    this.stop = viewport.addFrameListener(update);
  }
  dispose() {
    this.stop();
    this.element.remove();
  }
}
