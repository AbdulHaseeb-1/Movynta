import { Object3D, Vector2, Vector3 } from "three";
import type { EditorScene, ObjectTransform } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { GroupTransform, medianPosition, topLevel } from "./groupTransform";
import type { GizmoView, ObjectChange } from "./ObjectGizmo";
import { sameTransform } from "./transformMath";

type Operation = "move" | "rotate" | "scale";
type Axis = "x" | "y" | "z";
interface Target {
  id: string;
  object: Object3D;
  before: ObjectTransform;
}
interface Session {
  operation: Operation;
  axis: Axis | null;
  start: Vector2 | null;
  current: Vector2 | null;
  targets: Target[];
  revision: number;
  selected: readonly string[];
  cameraEnabled: boolean;
}
const AXIS = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Keyboard-driven object transforms. All updates are previews until confirmed. */
export class KeyboardTransform {
  private session: Session | undefined;
  private pointer: Vector2 | null = null;
  private readonly pivot = new Object3D();
  private readonly group = new GroupTransform();
  private readonly cleanups: (() => void)[] = [];
  constructor(
    viewport: Viewport,
    editor: EditorScene,
    view: GizmoView,
    commit: (changes: ObjectChange[]) => void,
    status: (text: string) => void,
    live: (id: string, transform: ObjectTransform) => void,
  ) {
    const dom = viewport.renderer.domElement;
    let pendingMove = false;
    const restore = (target: Target) => {
      target.object.position.fromArray(target.before.position);
      target.object.rotation.set(...target.before.rotation);
      target.object.scale.fromArray(target.before.scale);
      target.object.updateMatrixWorld(true);
    };
    const finish = (confirmed: boolean) => {
      const session = this.session;
      if (!session) return;
      pendingMove = false;
      this.session = undefined;
      const changes =
        confirmed &&
        view.enabled() &&
        editor.currentRevision === session.revision &&
        editor.selectedIds === session.selected
          ? session.targets.flatMap(({ id, before }) => {
              const after = editor.transformOf(id);
              return after && !sameTransform(before, after)
                ? [{ id, before, after }]
                : [];
            })
          : [];
      session.targets.forEach(restore);
      editor.previewBooleans();
      const active = editor.selection;
      const restored = active ? editor.transformOf(active) : undefined;
      if (active && restored) live(active, restored);
      this.group.end();
      viewport.controls.enabled = session.cameraEnabled;
      status("");
      if (changes.length) commit(changes);
    };
    const update = () => {
      const session = this.session;
      if (!session || !session.start || !session.current) return;
      const rect = dom.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const delta = session.current.clone().sub(session.start);
      const screenPivot = pivotOrigin.clone().project(viewport.camera);
      const center = new Vector2(
        rect.left + ((screenPivot.x + 1) * rect.width) / 2,
        rect.top + ((1 - screenPivot.y) * rect.height) / 2,
      );
      const startVector = session.start.clone().sub(center);
      const currentVector = session.current.clone().sub(center);
      this.pivot.position.copy(pivotOrigin);
      this.pivot.quaternion.identity();
      this.pivot.scale.set(1, 1, 1);
      const axis = session.axis ? AXIS[session.axis] : undefined;
      if (session.operation === "move") {
        const projected = pivotOrigin.clone().project(viewport.camera);
        if (axis) {
          const tip = pivotOrigin.clone().add(axis).project(viewport.camera);
          const screen = new Vector2(
            ((tip.x - projected.x) * rect.width) / 2,
            (-(tip.y - projected.y) * rect.height) / 2,
          );
          const amount =
            screen.lengthSq() < 4
              ? delta.x / 100
              : delta.dot(screen) / screen.lengthSq();
          this.pivot.position.addScaledVector(axis, amount);
        } else {
          const target = new Vector3(
            projected.x + (delta.x * 2) / rect.width,
            projected.y - (delta.y * 2) / rect.height,
            projected.z,
          ).unproject(viewport.camera);
          this.pivot.position.add(target.sub(pivotOrigin));
        }
      } else if (session.operation === "rotate") {
        const direction =
          axis ?? viewport.camera.getWorldDirection(new Vector3()).negate();
        const angle =
          startVector.length() < 8 || currentVector.length() < 8
            ? (delta.x - delta.y) * 0.01
            : Math.atan2(
                startVector.x * currentVector.y -
                  startVector.y * currentVector.x,
                startVector.dot(currentVector),
              );
        this.pivot.quaternion.setFromAxisAngle(direction, -angle);
      } else {
        const factor =
          startVector.length() < 8
            ? Math.exp(Math.max(-4, Math.min(4, (delta.x - delta.y) / 150)))
            : Math.max(
                0.001,
                Math.min(100, currentVector.length() / startVector.length()),
              );
        if (session.axis) this.pivot.scale[session.axis] = factor;
        else this.pivot.scale.setScalar(factor);
      }
      this.group.update(this.pivot);
      const active = editor.selection;
      const transformed = active ? editor.transformOf(active) : undefined;
      if (active && transformed) live(active, transformed);
      const previewError = editor.previewBooleans();
      status(previewError ?? `${session.operation[0]?.toUpperCase() ?? ""}${session.operation.slice(1)}${session.axis ? ` · ${session.axis.toUpperCase()}` : ""}  ·  X/Y/Z constrain  ·  Click or Enter confirm  ·  Esc cancel`);
    };
    const pivotOrigin = new Vector3();
    const flushMove = () => {
      if (!pendingMove) return;
      pendingMove = false;
      update();
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        isTyping(event.target) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat
      )
        return;
      const key = event.key.toLowerCase();
      const session = this.session;
      if (session) {
        if (
          key === "escape" ||
          key === "enter" ||
          key === "x" ||
          key === "y" ||
          key === "z"
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (key === "escape" || key === "enter") {
            if (key === "enter") flushMove();
            else pendingMove = false;
            finish(key === "enter");
          } else {
            session.axis = session.axis === key ? null : key;
            pendingMove = false;
            update();
          }
        }
        return;
      }
      const operation: Operation | undefined =
        key === "g"
          ? "move"
          : key === "r"
            ? "rotate"
            : key === "s"
              ? "scale"
              : undefined;
      if (!operation || !view.enabled() || !editor.selection) return;
      const targets: Target[] = [];
      for (const id of editor.selectedIds) {
        const object = editor.getObject(id);
        const before = editor.transformOf(id);
        if (object && before) targets.push({ id, object, before });
      }
      const roots = new Set(topLevel(targets.map((target) => target.object)));
      const selected = targets.filter((target) => roots.has(target.object));
      if (!selected.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      medianPosition(
        selected.map((target) => target.object),
        pivotOrigin,
      );
      this.pivot.position.copy(pivotOrigin);
      this.pivot.quaternion.identity();
      this.pivot.scale.set(1, 1, 1);
      this.pivot.updateMatrixWorld(true);
      this.group.begin(
        this.pivot,
        selected.map((target) => target.object),
      );
      this.session = {
        operation,
        axis: null,
        start: this.pointer?.clone() ?? null,
        current: this.pointer?.clone() ?? null,
        targets: selected,
        revision: editor.currentRevision,
        selected: editor.selectedIds,
        cameraEnabled: viewport.controls.enabled,
      };
      viewport.controls.enabled = false;
      status(
        `${operation === "move" ? "Move" : operation === "rotate" ? "Rotate" : "Scale"}  ·  X/Y/Z constrain  ·  Click or Enter confirm  ·  Esc cancel`,
      );
    };
    const move = (event: PointerEvent) => {
      this.pointer = new Vector2(event.clientX, event.clientY);
      const session = this.session;
      if (!session) return;
      if (
        !view.enabled() ||
        editor.currentRevision !== session.revision ||
        editor.selectedIds !== session.selected
      ) {
        finish(false);
        return;
      }
      session.start ??= this.pointer.clone();
      session.current = this.pointer.clone();
      pendingMove = true;
    };
    let blockContextMenu = false;
    const down = (event: PointerEvent) => {
      if (!this.session) return;
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      blockContextMenu = event.button === 2;
      if (event.button === 0) flushMove();
      else pendingMove = false;
      finish(event.button === 0);
    };
    const contextmenu = (event: MouseEvent) => {
      if (this.session || blockContextMenu) event.preventDefault();
      blockContextMenu = false;
    };
    const blur = () => finish(false);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("contextmenu", contextmenu, true);
    window.addEventListener("blur", blur);
    const unsubscribe = editor.onChange(() => {
      const session = this.session;
      if (
        session &&
        (editor.currentRevision !== session.revision ||
          editor.selectedIds !== session.selected)
      )
        finish(false);
    });
    const stopFrame = viewport.addFrameListener(() => {
      if (this.session && !view.enabled()) finish(false);
      else flushMove();
    });
    this.cleanups.push(
      editor.onBeforeChange(() => finish(false)),
      () => window.removeEventListener("keydown", keydown, true),
      () => window.removeEventListener("pointermove", move, true),
      () => window.removeEventListener("pointerdown", down, true),
      () => window.removeEventListener("contextmenu", contextmenu, true),
      () => window.removeEventListener("blur", blur),
      unsubscribe,
      stopFrame,
      () => finish(false),
    );
  }
  dispose() {
    for (const cleanup of this.cleanups) cleanup();
  }
}
