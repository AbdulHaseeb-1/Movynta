import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  Matrix3,
  Plane,
  Raycaster,
  SkinnedMesh,
  Vector2,
  Vector3,
  type Object3D,
} from "three";
import type { EditorScene } from "@/features/assistant";
import { setCameraRay } from "@/features/viewport3d/cameraRay";
import type { Viewport } from "@/features/viewport3d";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { readTopology, faceNormal, type PolygonMesh } from "@/features/meshGeometry/meshTopology";
import { triangulate, writeShadedGeometry } from "@/features/meshGeometry/meshOutput";
import type { KnifePoint } from "@/features/meshGeometry/meshKnifeChord";
import { KnifeSession } from "@/features/meshGeometry/meshKnifeSession";
import { extrudeIsActive } from "@/features/objectEditing/ExtrudeGesture";
import { errorMessage } from "@/lib";
import { cutKnifeStroke } from "./knifeStroke";
import { knifeGraph, projectKnife, snapKnife } from "./knifeProjection";
import { defaultKnifeSettings, type KnifeSettings } from "./knifeSettings";
import { setKnifeActivity } from "./knifeActivity";

/** What a Knife stroke is aimed at: the mesh, and the point it is over. */
export interface KnifeTarget {
  objectId: string;
  meshPath: number[];
  selectedFaces: number[];
}
/** The stroke a Knife gesture commits, to be applied as one edit. */
export interface KnifeCommit {
  objectId: string;
  meshPath: number[];
  revision: number;
  segments: { face: string; start: KnifePoint; end: KnifePoint }[];
}
interface Stroke {
  from: Vector2;
  to: Vector2;
  count: number;
  view: string;
}
interface Session {
  target: KnifeTarget;
  mesh: Mesh;
  source: BufferGeometry;
  preview: BufferGeometry | null;
  revision: number;
  knife: KnifeSession;
  anchor: Vector2 | null;
  cursor: Vector2 | null;
  down: Vector2 | null;
  strokes: Stroke[];
  cutThrough: boolean;
  onlySelected: boolean;
  xray: boolean;
  angle: number;
  angleMode: number;
  numeric: string;
  reference: number;
  axis: { index: number; local: boolean } | null;
  measures: number;
  error: string;
  svg: SVGSVGElement;
  middle: MOUSE | null | undefined;
  pointerId: number | null;
  relativeAngle: number | null;
  constraintBlocked: boolean;
}
function typing(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || Boolean(target.closest('input,textarea,select,[role="dialog"],[role="menu"]')))
  );
}
function visible(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Owns the modal pointer/key interaction and temporary geometry; confirmation emits one saved path. */
export class KnifeGesture {
  private session: Session | null = null;
  private readonly cleanup: (() => void)[] = [];
  private pick: {
    mesh: PolygonMesh;
    geometry: BufferGeometry;
    proxy: Mesh<BufferGeometry, MeshBasicMaterial>;
    faces: number[];
  } | null = null;
  private space = false;
  constructor(
    privateViewport: Viewport,
    editor: EditorScene,
    enabled: () => boolean,
    target: () => KnifeTarget | null,
    commit: (value: KnifeCommit) => void,
    report: (message: string) => void,
    status: (message: string) => void,
    activity: (active: boolean) => void,
    settings: () => KnifeSettings = () => defaultKnifeSettings,
    changedSettings: (settings: KnifeSettings) => void = () => undefined,
  ) {
    const viewport = privateViewport,
      dom = viewport.renderer.domElement,
      ray = new Raycaster();
    const clearPick = () => {
      this.pick?.geometry.dispose();
      this.pick?.proxy.material.dispose();
      this.pick = null;
    };
    const getPick = (mesh: PolygonMesh) => {
      if (this.pick?.mesh === mesh) return this.pick;
      clearPick();
      const positions: number[] = [],
        faces: number[] = [];
      mesh.faces.forEach((face, i) => {
        for (const triangle of triangulate(mesh, face)) {
          for (const corner of triangle) {
            const p = mesh.positions[face[corner] ?? -1];
            if (!p) throw new Error("Invalid Knife face");
            positions.push(p.x, p.y, p.z);
          }
          faces.push(i);
        }
      });
      const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(positions, 3)),
        proxy = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
      proxy.matrixAutoUpdate = false;
      this.pick = { mesh, geometry, proxy, faces };
      return this.pick;
    };
    const restore = (s: Session) => {
      if (s.preview && s.mesh.geometry === s.preview) s.mesh.geometry = s.source;
      s.preview?.dispose();
      s.preview = null;
      clearPick();
    };
    const finish = (confirmed: boolean) => {
      const s = this.session;
      if (!s) return;
      const valid =
        confirmed && s.knife.length > 0 && editor.currentRevision === s.revision && !editor.requiresRecovery;
      restore(s);
      if (s.pointerId !== null && dom.hasPointerCapture(s.pointerId)) dom.releasePointerCapture(s.pointerId);
      this.space = false;
      s.svg.remove();
      dom.style.cursor = "";
      viewport.controls.mouseButtons.MIDDLE = s.middle;
      this.session = null;
      setKnifeActivity(false);
      activity(false);
      status("");
      if (valid)
        commit({
          ...s.target,
          revision: s.revision,
          segments: s.knife.segments.map((segment) => ({
            ...segment,
            face: String(segment.face),
          })),
        });
    };
    const bounds = () => dom.getBoundingClientRect();
    const viewSignature = () => {
      viewport.camera.updateMatrixWorld();
      const r = bounds();
      return `${viewport.camera.matrixWorld.elements.join(",")}:${viewport.camera.projectionMatrix.elements.join(",")}:${r.width}:${r.height}:${r.left}:${r.top}`;
    };
    const pixel = (event: Pick<PointerEvent, "clientX" | "clientY">) => {
      const rect = bounds();
      return new Vector2(event.clientX - rect.left, event.clientY - rect.top);
    };
    const surfaceHit = (s: Session, pixelPoint: Vector2) => {
      const rect = bounds(),
        pick = getPick(s.knife.mesh);
      s.mesh.updateWorldMatrix(true, false);
      pick.proxy.matrixWorld.copy(s.mesh.matrixWorld);
      setCameraRay(
        ray,
        new Vector2((pixelPoint.x / rect.width) * 2 - 1, 1 - (pixelPoint.y / rect.height) * 2),
        viewport.camera,
      );
      const hit = ray.intersectObject(pick.proxy, false).find((entry) => {
        const depth = entry.point.clone().project(viewport.camera).z;
        return depth >= -1 && depth <= 1;
      });
      const face = hit ? pick.faces[hit.faceIndex ?? -1] : undefined;
      return hit && face !== undefined ? { point: hit.point, face } : null;
    };
    const surface = (s: Session, p: Vector2): Vector3 | null => surfaceHit(s, p)?.point ?? null;
    const isVisible = (s: Session, mesh: PolygonMesh, face: number, midpoint: Vector2) => {
      if (s.cutThrough) return true;
      const rect = bounds(),
        pick = getPick(mesh);
      s.mesh.updateWorldMatrix(true, false);
      pick.proxy.matrixWorld.copy(s.mesh.matrixWorld);
      setCameraRay(
        ray,
        new Vector2((midpoint.x / rect.width) * 2 - 1, 1 - (midpoint.y / rect.height) * 2),
        viewport.camera,
      );
      const hit = ray.intersectObject(pick.proxy, false).find((entry) => {
        const depth = entry.point.clone().project(viewport.camera).z;
        return depth >= -1 && depth <= 1;
      });
      if (!hit || pick.faces[hit.faceIndex ?? -1] !== face) return false;
      const blocker = ray
        .intersectObjects(viewport.scene.children, true)
        .find(
          (entry) =>
            entry.point.clone().project(viewport.camera).z >= -1 &&
            entry.point.clone().project(viewport.camera).z <= 1 &&
            entry.object instanceof Mesh &&
            entry.object !== s.mesh &&
            visible(entry.object) &&
            entry.distance < hit.distance - 1e-6,
        );
      return !blocker;
    };
    const constrained = (
      s: Session,
      event: Pick<PointerEvent, "clientX" | "clientY" | "ctrlKey" | "metaKey" | "shiftKey">,
    ) => {
      s.relativeAngle = null;
      s.constraintBlocked = false;
      const rect = bounds();
      s.mesh.updateWorldMatrix(true, false);
      let cursor = pixel(event);
      const projected = projectKnife(s.knife.mesh, s.mesh.matrixWorld, viewport.camera, rect.width, rect.height);
      if (!event.ctrlKey && !event.metaKey)
        cursor = snapKnife(s.knife.mesh, projected, cursor, event.shiftKey, (local) => {
          if (s.cutThrough) return true;
          const world = local.clone().applyMatrix4(s.mesh.matrixWorld);
          const ndc = world.clone().project(viewport.camera);
          setCameraRay(ray, new Vector2(ndc.x, ndc.y), viewport.camera);
          const distance = world.distanceTo(viewport.camera.position),
            tolerance = Math.max(1e-5, distance * 1e-6);
          const pick = getPick(s.knife.mesh);
          pick.proxy.matrixWorld.copy(s.mesh.matrixWorld);
          const nearest = ray.intersectObject(pick.proxy, false).find((entry) => {
            const depth = entry.point.clone().project(viewport.camera).z;
            return depth >= -1 && depth <= 1;
          });
          if (nearest && nearest.distance < distance - tolerance) return false;
          return !ray.intersectObjects(viewport.scene.children, true).some((hit) => {
            const depth = hit.point.clone().project(viewport.camera).z;
            return (
              depth >= -1 &&
              depth <= 1 &&
              hit.object instanceof Mesh &&
              hit.object !== s.mesh &&
              visible(hit.object) &&
              hit.distance < distance - tolerance
            );
          });
        });
      if (!s.anchor) return cursor;
      const anchor = s.anchor;
      if (s.axis) {
        let base = surface(s, anchor);
        if (!base) {
          setCameraRay(
            ray,
            new Vector2((anchor.x / rect.width) * 2 - 1, 1 - (anchor.y / rect.height) * 2),
            viewport.camera,
          );
          const normal = viewport.camera.getWorldDirection(new Vector3());
          base = ray.ray.intersectPlane(
            new Plane().setFromNormalAndCoplanarPoint(normal, viewport.controls.target),
            new Vector3(),
          );
        }
        if (base) {
          const direction = new Vector3().setComponent(s.axis.index, 1);
          if (s.axis.local) direction.transformDirection(s.mesh.matrixWorld);
          const a = base.clone().project(viewport.camera),
            b = base.clone().add(direction).project(viewport.camera);
          const axis = new Vector2(((b.x - a.x) * rect.width) / 2, (-(b.y - a.y) * rect.height) / 2).normalize();
          if (axis.lengthSq() > 1e-12)
            cursor = anchor.clone().addScaledVector(axis, cursor.clone().sub(anchor).dot(axis));
        }
      } else if (s.angleMode === 1) {
        const delta = cursor.clone().sub(anchor),
          step = (s.angle * Math.PI) / 180;
        const angle = Math.round(Math.atan2(delta.y, delta.x) / step) * step;
        cursor = anchor.clone().add(new Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(delta.length()));
        s.relativeAngle = null;
      } else if (s.angleMode === 2) {
        const hit = surfaceHit(s, anchor);
        if (hit) {
          const face = s.knife.mesh.faces[hit.face];
          if (face) {
            const normal = faceNormal(s.knife.mesh, face).applyNormalMatrix(
              new Matrix3().getNormalMatrix(s.mesh.matrixWorld),
            );
            const plane = new Plane().setFromNormalAndCoplanarPoint(normal, hit.point);
            setCameraRay(
              ray,
              new Vector2((cursor.x / rect.width) * 2 - 1, 1 - (cursor.y / rect.height) * 2),
              viewport.camera,
            );
            const destination = ray.ray.intersectPlane(plane, new Vector3());
            const referenceCorner = s.reference % face.length,
              a = s.knife.mesh.positions[face[referenceCorner] ?? -1],
              b = s.knife.mesh.positions[face[(referenceCorner + 1) % face.length] ?? -1];
            if (destination && a && b) {
              const horizontal = b.clone().sub(a).transformDirection(s.mesh.matrixWorld),
                vertical = normal.clone().cross(horizontal).normalize(),
                delta = destination.sub(hit.point);
              const step = (s.angle * Math.PI) / 180,
                angle = Math.round(Math.atan2(delta.dot(vertical), delta.dot(horizontal)) / step) * step;
              const world = hit.point
                .clone()
                .addScaledVector(horizontal, Math.cos(angle) * delta.length())
                .addScaledVector(vertical, Math.sin(angle) * delta.length())
                .project(viewport.camera);
              cursor = new Vector2(((world.x + 1) * rect.width) / 2, ((1 - world.y) * rect.height) / 2);
              s.relativeAngle = (angle * 180) / Math.PI;
              s.error = "";
            }
          }
        } else {
          s.constraintBlocked = true;
          s.error = "Relative angle needs a start point on a face.";
        }
      }
      return cursor;
    };
    const draw = () => {
      const s = this.session;
      if (!s) return;
      const rect = bounds();
      s.svg.style.left = `${rect.left}px`;
      s.svg.style.top = `${rect.top}px`;
      s.svg.setAttribute("width", String(rect.width));
      s.svg.setAttribute("height", String(rect.height));
      s.svg.replaceChildren();
      const line = (a: Vector2, b: Vector2, dashed: boolean) => {
        const element = document.createElementNS("http://www.w3.org/2000/svg", "line");
        element.setAttribute("x1", String(a.x));
        element.setAttribute("y1", String(a.y));
        element.setAttribute("x2", String(b.x));
        element.setAttribute("y2", String(b.y));
        element.setAttribute("stroke", "currentColor");
        element.setAttribute("stroke-width", "2");
        if (dashed) element.setAttribute("stroke-dasharray", "5 4");
        s.svg.appendChild(element);
      };
      const projected = projectKnife(s.knife.mesh, s.mesh.matrixWorld, viewport.camera, rect.width, rect.height);
      const graph = knifeGraph(s.knife.mesh);
      for (const key of s.knife.selection) {
        const incident = graph.edges.get(key) ?? [];
        const half = incident[0];
        if (!half) continue;
        const a = projected[half.from],
          b = projected[half.to];
        if (!a || !b || a.w <= 0 || b.w <= 0) continue;
        const mid = a.screen.clone().add(b.screen).multiplyScalar(0.5);
        const shown = s.xray || isVisible({ ...s, cutThrough: false }, s.knife.mesh, half.face, mid);
        if (s.xray || shown) line(a.screen, b.screen, !shown);
      }
      if (s.anchor && s.cursor) line(s.anchor, s.cursor, true);
      if (s.cursor) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", String(s.cursor.x));
        circle.setAttribute("cy", String(s.cursor.y));
        circle.setAttribute("r", "4");
        circle.setAttribute("fill", "currentColor");
        s.svg.appendChild(circle);
      }
      let measure = "";
      if (s.anchor && s.cursor && s.measures) {
        const a = surface(s, s.anchor),
          b = surface(s, s.cursor);
        const distance =
          a && b ? `${a.distanceTo(b).toPrecision(4)} world units` : `${s.anchor.distanceTo(s.cursor).toFixed(1)} px`;
        const angle = s.relativeAngle ?? (Math.atan2(s.cursor.y - s.anchor.y, s.cursor.x - s.anchor.x) * 180) / Math.PI;
        measure =
          s.measures === 1
            ? distance
            : s.measures === 2
              ? `${angle.toFixed(1)}° ${s.relativeAngle === null ? "screen" : "relative"}`
              : `${distance} · ${angle.toFixed(1)}° ${s.relativeAngle === null ? "screen" : "relative"}`;
      }
      status(
        `Knife · ${s.knife.length} cuts · Click/drag draw · Enter confirm · Esc cancel · RMB/E new cut · Ctrl+Z undo · C through ${s.cutThrough ? "on" : "off"} · V X-ray ${s.xray ? "on" : "off"} · A ${s.angleMode === 0 ? "angle off" : `${s.angleMode === 1 ? "screen" : "relative"} ${s.numeric || s.angle}°`} · ${s.axis ? `${["X", "Y", "Z"][s.axis.index]} ${s.axis.local ? "local" : "global"}` : "X/Y/Z axes"} · Shift midpoint · Ctrl ignore snap · S measure${s.onlySelected ? " · Selected faces only" : ""}${measure ? ` · ${measure}` : ""}${s.error ? ` · ${s.error}` : ""}`,
      );
    };
    const preview = (s: Session) => {
      restore(s);
      if (s.knife.length) {
        s.preview = writeShadedGeometry(s.source, s.knife.mesh);
        s.mesh.geometry = s.preview;
      }
      draw();
    };
    const addLine = (s: Session, to: Vector2) => {
      if (!s.anchor) {
        s.anchor = to.clone();
        draw();
        return;
      }
      if (s.angleMode && s.numeric && (!(Number(s.numeric) > 0) || Number(s.numeric) > 180)) {
        s.error = "Angle must be greater than zero and at most 180 degrees.";
        draw();
        return;
      }
      if (s.constraintBlocked) {
        draw();
        return;
      }
      const from = s.anchor.clone();
      if (from.distanceTo(to) < 1) return;
      const previous = s.knife.length;
      try {
        const rect = bounds();
        const count = cutKnifeStroke(
          s.knife,
          s.mesh.matrixWorld,
          viewport.camera,
          rect.width,
          rect.height,
          from,
          to,
          s.onlySelected ? s.target.selectedFaces : null,
          (mesh, face, mid) => isVisible(s, mesh, face, mid),
        );
        if (!count) {
          s.error = "Draw across a complete face; interior or loose cuts are unsupported.";
          draw();
          return;
        }
        preview(s);
        s.strokes.push({ from, to: to.clone(), count, view: viewSignature() });
        s.anchor = to.clone();
        s.error = "";
      } catch (error) {
        if (s.knife.length > previous) s.knife.undo(s.knife.length - previous);
        preview(s);
        s.error = errorMessage(error);
        report(s.error);
      }
      draw();
    };
    this.start = (onlySelected = false) => {
      if (this.session || !enabled() || extrudeIsActive()) return;
      try {
        const choice = target();
        if (!choice) throw new Error("Select a component on the intended mesh part before starting Knife.");
        if (onlySelected && !choice.selectedFaces.length)
          throw new Error("Select faces before starting Knife with Shift+K.");
        const mesh = meshAtPath(editor.getObject(choice.objectId), choice.meshPath);
        if (mesh instanceof SkinnedMesh) throw new Error("Knife on skinned meshes is unsupported.");
        const modifiers = modifierStack(mesh)?.modifiers ?? [];
        if (modifiers.some((entry) => entry.enabled)) throw new Error("Disable modifiers before using Knife.");
        if (modifiers.some((entry) => entry.kind === "extrusion"))
          throw new Error("Remove live extrusion before using Knife.");
        const source = mesh.geometry,
          cage = readTopology(source),
          svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = "position:fixed;pointer-events:none;z-index:30;color:var(--brand);overflow:hidden";
        document.body.appendChild(svg);
        this.session = {
          target: choice,
          mesh,
          source,
          preview: null,
          revision: editor.currentRevision,
          knife: new KnifeSession(cage, source),
          anchor: null,
          cursor: null,
          down: null,
          strokes: [],
          cutThrough: settings().cutThrough,
          onlySelected,
          xray: settings().xray,
          angle: settings().angle,
          angleMode: settings().angleMode,
          numeric: "",
          reference: 0,
          axis: null,
          measures: settings().measures,
          error: "",
          svg,
          middle: viewport.controls.mouseButtons.MIDDLE,
          pointerId: null,
          relativeAngle: null,
          constraintBlocked: false,
        };
        viewport.controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
        dom.style.cursor = "crosshair";
        setKnifeActivity(true);
        activity(true);
        report("");
        draw();
      } catch (error) {
        report(errorMessage(error));
      }
    };
    let lastPointer: { clientX: number; clientY: number } | null = null;
    const keydown = (event: KeyboardEvent) => {
      if (typing(event)) return;
      const key = event.key.toLowerCase();
      if (!this.session) {
        if (key === "k" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && enabled()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.start(event.shiftKey);
        }
        return;
      }
      const s = this.session;
      if (key === " ") {
        this.space = true;
        s.down = null;
        s.anchor = null;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (key === "escape") {
        finish(false);
        return;
      }
      if (key === "enter" || event.code === "NumpadEnter") {
        finish(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey && !event.altKey) {
        if (s.down) {
          s.down = null;
          s.anchor = null;
          if (s.pointerId !== null && dom.hasPointerCapture(s.pointerId)) dom.releasePointerCapture(s.pointerId);
          s.pointerId = null;
          draw();
          return;
        }
        const stroke = s.strokes.pop();
        if (stroke) {
          s.knife.undo(stroke.count);
          s.anchor = stroke.view === viewSignature() ? stroke.from : null;
          preview(s);
        }
        return;
      }
      // Other Ctrl, Cmd and Alt combinations (copy, select all, redo, ...) are not Knife keys: swallowed, not acted on.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (key === "e" || key === "rightmouse") s.anchor = null;
      else if (key === "c") s.cutThrough = !s.cutThrough;
      else if (key === "v") s.xray = !s.xray;
      else if (key === "s") s.measures = (s.measures + 1) % 4;
      else if (key === "a") {
        s.angleMode = (s.angleMode + 1) % 3;
        s.axis = null;
        s.numeric = "";
      } else if (key === "r") s.reference++;
      else if (["x", "y", "z"].includes(key)) {
        const index = ["x", "y", "z"].indexOf(key);
        s.axis = s.axis?.index === index ? (s.axis.local ? null : { index, local: true }) : { index, local: false };
        s.angleMode = 0;
      } else if (s.angleMode && (/^[0-9.]$/.test(key) || key === "backspace")) {
        const numeric = key === "backspace" ? s.numeric.slice(0, -1) : s.numeric + key;
        if (/^\d*(\.\d*)?$/.test(numeric) && numeric.length < 12) {
          s.numeric = numeric;
          const value = Number(numeric);
          if (value > 0 && value <= 180) s.angle = value;
        }
      }
      if (lastPointer)
        s.cursor = constrained(s, {
          ...lastPointer,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
      changedSettings({
        cutThrough: s.cutThrough,
        xray: s.xray,
        angle: s.angle,
        angleMode: s.angleMode,
        measures: s.measures,
      });
      draw();
    };
    const move = (event: PointerEvent) => {
      const s = this.session;
      if (!s || this.space || event.buttons === 4) return;
      lastPointer = { clientX: event.clientX, clientY: event.clientY };
      s.cursor = constrained(s, event);
      draw();
    };
    const down = (event: PointerEvent) => {
      const s = this.session;
      if (!s || event.target !== dom) return;
      if (event.button === 1 || this.space) {
        s.down = null;
        s.anchor = null;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button === 2) {
        s.down = null;
        s.anchor = null;
        draw();
        return;
      }
      if (event.button !== 0) return;
      lastPointer = { clientX: event.clientX, clientY: event.clientY };
      s.cursor = constrained(s, event);
      s.down = s.cursor.clone();
      if (!s.anchor) s.anchor = s.cursor.clone();
      s.pointerId = event.pointerId;
      dom.setPointerCapture(event.pointerId);
      draw();
    };
    const up = (event: PointerEvent) => {
      const s = this.session;
      if (!s || !s.down || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const to = constrained(s, event);
      const press = s.down;
      s.down = null;
      s.pointerId = null;
      if (dom.hasPointerCapture(event.pointerId)) dom.releasePointerCapture(event.pointerId);
      if (press.distanceTo(to) > 3 || (s.anchor && s.anchor.distanceTo(to) > 1)) addLine(s, to);
    };
    const context = (event: Event) => {
      if (this.session && event.target === dom) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") this.space = false;
      if (this.session && lastPointer && !typing(event)) {
        this.session.cursor = constrained(this.session, {
          ...lastPointer,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
        draw();
      }
    };
    const cancel = () => finish(false);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("contextmenu", context, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("pointercancel", cancel, true);
    let cameraSignature = "";
    this.cleanup.push(
      () => window.removeEventListener("keydown", keydown, true),
      () => window.removeEventListener("keyup", keyup, true),
      () => window.removeEventListener("pointerdown", down, true),
      () => window.removeEventListener("pointermove", move, true),
      () => window.removeEventListener("pointerup", up, true),
      () => window.removeEventListener("contextmenu", context, true),
      () => window.removeEventListener("blur", cancel),
      () => window.removeEventListener("pointercancel", cancel, true),
      editor.onBeforeChange(cancel),
      editor.onChange(() => {
        if (
          this.session &&
          (editor.currentRevision !== this.session.revision || editor.selection !== this.session.target.objectId)
        )
          cancel();
      }),
      viewport.addFrameListener(() => {
        if (this.session && !enabled()) cancel();
        if (this.session) {
          viewport.camera.updateMatrixWorld();
          const rect = bounds();
          const signature = `${viewport.camera.matrixWorld.elements.join(",")}:${viewport.camera.projectionMatrix.elements.join(",")}:${rect.width}:${rect.height}:${rect.left}:${rect.top}`;
          if (cameraSignature && signature !== cameraSignature) {
            this.session.anchor = null;
            this.session.down = null;
            draw();
          }
          cameraSignature = signature;
        }
      }),
      cancel,
      clearPick,
    );
  }
  readonly start: (onlySelected?: boolean) => void;
  dispose(): void {
    for (const cleanup of this.cleanup) cleanup();
  }
}
