import {
  BufferGeometry,
  Float32BufferAttribute,
  Object3D,
  Points,
  PointsMaterial,
  Vector3,
  type Matrix4,
} from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { EditorScene, ObjectTransform } from "@/features/assistant";
import {
  watchClicks,
  type Viewport,
  type ViewportTool,
} from "@/features/viewport3d";
import { GroupTransform, medianPosition, topLevel } from "./groupTransform";
import { assignLocalMatrix, correctWorldRotation, hasNonUniformWorldScale } from "./shearFit";
import { HANDLE_MODES, isHandleTool, type HandleMode } from "./handleModes";
import { styleHandles } from "./handleStyle";
import { pickObjectId, pickObjectIds, toNdc } from "./picking";
import { bindShiftSnap } from "./shiftSnap";
import { sameTransform } from "./transformMath";

function rotationOf(controls: TransformControls): { axis: Vector3; angle: number } | undefined {
  if (!("rotationAxis" in controls) || !("rotationAngle" in controls)) return undefined;
  const axis: unknown = controls.rotationAxis;
  const angle: unknown = controls.rotationAngle;
  if (!(axis instanceof Vector3) || typeof angle !== "number" || !Number.isFinite(angle)) return undefined;
  return { axis, angle };
}

const GIZMO_SIZE = 0.62;
/** The dot that marks an object's origin, in the same orange as its outline. */
const ORIGIN_COLOR = "#ff9b21";
const ORIGIN_SIZE_PX = 7;

/** What the gizmo asks of its owner on every frame, so it never works from a stale copy. */
export interface GizmoView {
  tool: () => ViewportTool;
  /** False while the assistant works, which turns the handles off. */
  enabled: () => boolean;
  /** Whole-object selection markers and clicks are only used in Object mode. */
  objectMode?: () => boolean;
}

/** An object that a drag moved: where it was and where it is now. */
export interface ObjectChange {
  id: string;
  before: ObjectTransform;
  after: ObjectTransform;
}

export interface GizmoEvents {
  /** The user is dragging a handle: the active object's current transform. */
  onLiveChange: (id: string, transform: ObjectTransform) => void;
  /** A drag ended: every object it moved, with where each was and is. */
  onCommit: (changes: ObjectChange[]) => void;
  onPreviewError?: (message: string) => void;
}

/** The objects a group drag moves, with the transform each started from. */
interface Dragged {
  id: string;
  object: Object3D;
  before: ObjectTransform;
}

/**
 * Everything the user does with the mouse on objects in the workspace: clicking to select (Shift adds
 * to the selection or takes away from it, as in Blender), the move, rotate and scale handles, and the
 * markings of the selection (an orange outline and an origin dot). The selection itself lives in the
 * {@link EditorScene}; this follows it, so a selection made by the assistant, or an object it deletes,
 * is reflected here without extra wiring.
 *
 * One selected object has the handles on itself. Several have them at their median point, and every
 * drag moves, turns or scales all of them together about that point.
 */
export class ObjectGizmo {
  private readonly viewport: Viewport;
  private readonly editor: EditorScene;
  private readonly events: GizmoEvents;
  private readonly controls: TransformControls;
  private readonly origin: Points;
  private readonly originMaterial: PointsMaterial;
  private readonly cleanups: (() => void)[] = [];
  private readonly view: GizmoView;
  /** What the handles hold on to when several objects are selected. It is not part of the scene. */
  private readonly pivot = new Object3D();
  private readonly group = new GroupTransform();
  private mode: HandleMode | undefined;
  /** The selection and scene revision the outline and the pivot were last made for. */
  private outlinedFor: { ids: readonly string[]; revision: number; objectMode: boolean } | undefined;
  private pivotFor: { ids: readonly string[]; revision: number } | undefined;
  private before: ObjectTransform | undefined;
  private dragged: Dragged[] = [];
  /** World matrix of a single object when its drag began, so a world rotation can be rebuilt exactly. */
  private dragWorld: Matrix4 | undefined;

  constructor(
    viewport: Viewport,
    editor: EditorScene,
    events: GizmoEvents,
    view: GizmoView,
  ) {
    this.viewport = viewport;
    this.editor = editor;
    this.events = events;
    this.view = view;
    const dom = viewport.renderer.domElement;

    this.controls = new TransformControls(viewport.camera, dom);
    styleHandles(this.controls, GIZMO_SIZE);
    viewport.scene.add(this.controls.getHelper());
    viewport.scene.add(this.pivot);

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
    this.originMaterial = new PointsMaterial({
      color: ORIGIN_COLOR,
      size: ORIGIN_SIZE_PX,
      sizeAttenuation: false,
      depthTest: false,
    });
    this.origin = new Points(geometry, this.originMaterial);
    this.origin.renderOrder = 999;
    this.origin.visible = false;
    // The dot is not an object of the scene, so it can never be picked or sent to the assistant.
    this.origin.raycast = () => undefined;
    viewport.scene.add(this.origin);

    // While a handle is dragged the camera must stay put.
    let livePending = false;
    let groupPending = false;
    const flushLiveChange = () => {
      if (groupPending) {
        groupPending = false;
        this.group.update(this.pivot);
      } else if (livePending) this.correctSingleRotation();
      if (!livePending) return;
      livePending = false;
      const id = this.editor.selection;
      const transform = id ? this.editor.transformOf(id) : undefined;
      if (id && transform) this.events.onLiveChange(id, transform);
      if (this.dragged.length > 0 || this.before) {
        const error = this.editor.previewBooleans();
        this.events.onPreviewError?.(error ?? "");
      }
    };
    const onDragging = (event: { value?: unknown }) => {
      const dragging = event.value === true;
      viewport.controls.enabled = !dragging;
      if (dragging) this.beginDrag();
      else {
        flushLiveChange();
        this.endDrag();
      }
    };
    this.controls.addEventListener("dragging-changed", onDragging);
    const onObjectChange = () => {
      if (this.dragged.length > 0) groupPending = true;
      livePending = true;
    };
    this.controls.addEventListener("objectChange", onObjectChange);

    const stopClicks = watchClicks(dom, {
      // A press on a handle drags it; it is never a click on the scene.
      ignore: () => this.controls.axis !== null,
      onClick: (event) => {
        if (this.view.tool() === "pan" || this.view.objectMode?.() === false) return;
        const ndc = toNdc(
          event.clientX,
          event.clientY,
          dom.getBoundingClientRect(),
        );
        if (event.altKey && !event.shiftKey) {
          const hits = pickObjectIds(this.editor, viewport.camera, ndc);
          const index = hits.findIndex((id) => id === this.editor.selection);
          this.editor.select(hits.length ? hits[(index + 1) % hits.length] ?? null : null);
          return;
        }
        const hit = pickObjectId(this.editor, viewport.camera, ndc);
        if (!event.shiftKey) this.editor.select(hit ?? null);
        else if (hit !== undefined) this.editor.toggleSelection(hit);
      },
    });

    const removeFrameListener = viewport.addFrameListener(() => {
      flushLiveChange();
      this.sync();
    });

    this.cleanups.push(
      () => this.cancelDrag(),
      () => this.controls.removeEventListener("dragging-changed", onDragging),
      () => this.controls.removeEventListener("objectChange", onObjectChange),
      stopClicks,
      this.editor.onBeforeChange(() => this.cancelDrag()),
      bindShiftSnap(this.controls),
      removeFrameListener,
    );
  }

  dispose() {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.viewport.controls.enabled = true;
    this.viewport.setOutlinedObjects([]);
    this.controls.detach();
    this.viewport.scene.remove(this.controls.getHelper());
    this.controls.dispose();
    this.viewport.scene.remove(this.pivot);
    this.viewport.scene.remove(this.origin);
    this.origin.geometry.dispose();
    this.originMaterial.dispose();
  }

  /** Puts a live drag back when another edit starts, so the saved change is not mixed with the preview. */
  private cancelDrag() {
    if (this.dragged.length === 0 && !this.before) return;
    for (const item of this.dragged) {
      item.object.position.fromArray(item.before.position);
      item.object.rotation.set(...item.before.rotation);
      item.object.scale.fromArray(item.before.scale);
      item.object.updateMatrixWorld(true);
    }
    const single = this.controls.object;
    if (this.before && single && single !== this.pivot) {
      single.position.fromArray(this.before.position);
      single.rotation.set(...this.before.rotation);
      single.scale.fromArray(this.before.scale);
      single.updateMatrixWorld(true);
    }
    this.dragged = [];
    this.before = undefined;
    this.dragWorld = undefined;
    this.group.end();
    this.editor.previewBooleans();
  }

  /** Remembers where everything is before a handle moves it. */
  private beginDrag() {
    const target = this.controls.object;
    if (target && target !== this.pivot) {
      target.updateWorldMatrix(true, false);
      this.dragWorld = target.matrixWorld.clone();
    } else this.dragWorld = undefined;
    if (this.controls.object === this.pivot) {
      const selected: Dragged[] = [];
      for (const id of this.editor.selectedIds) {
        const object = this.editor.getObject(id);
        const before = this.editor.transformOf(id);
        if (object && before) selected.push({ id, object, before });
      }
      const moving = new Set(topLevel(selected.map((item) => item.object)));
      this.dragged = selected.filter((item) => moving.has(item.object));
      this.group.begin(
        this.pivot,
        this.dragged.map((item) => item.object),
      );
      return;
    }
    const id = this.editor.selection;
    this.before = id ? this.editor.transformOf(id) : undefined;
  }

  /** Reports what the drag changed, if anything. */
  private endDrag() {
    const changes: ObjectChange[] = [];
    if (this.dragged.length > 0) this.group.commit();
    else if (this.controls.object && this.controls.object !== this.pivot && !this.controls.object.matrixAutoUpdate)
      assignLocalMatrix(this.controls.object, this.controls.object.matrix, true);
    if (this.dragged.length > 0) {
      for (const { id, before } of this.dragged) {
        const after = this.editor.transformOf(id);
        if (after && !sameTransform(before, after))
          changes.push({ id, before, after });
      }
      this.dragged = [];
      this.group.end();
    } else {
      const id = this.editor.selection;
      const after = id ? this.editor.transformOf(id) : undefined;
      if (id && this.before && after && !sameTransform(this.before, after))
        changes.push({ id, before: this.before, after });
      this.before = undefined;
    }
    this.dragWorld = undefined;
    if (changes.length > 0) this.events.onCommit(changes);
  }

  /**
   * The handles turn an object by its parent's rotation and ignore the parent's scale. When that scale
   * is non-uniform, rebuild the same world rotation so the shape does not squash.
   */
  private correctSingleRotation(): void {
    const object = this.controls.object;
    if (!object || object === this.pivot || this.controls.mode !== "rotate" || this.controls.space !== "world") return;
    if (!this.dragWorld || !hasNonUniformWorldScale(object)) return;
    const rotation = rotationOf(this.controls);
    if (!rotation) return;
    correctWorldRotation(object, this.dragWorld, rotation.axis, rotation.angle);
  }

  /** Puts the pivot at the median point of what a drag would move, upright and unscaled. */
  private placePivot() {
    const { selectedIds: ids, currentRevision: revision } = this.editor;
    if (this.pivotFor?.ids === ids && this.pivotFor.revision === revision)
      return;
    this.pivotFor = { ids, revision };
    const objects = ids.flatMap((id) => this.editor.getObject(id) ?? []);
    medianPosition(topLevel(objects), this.pivot.position);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
  }

  /**
   * Keeps the markings on the selected objects. Every batch of changes replaces the scene's objects with
   * copies, so this finds the current ones whenever the scene or the selection changed, rather than
   * holding on to stale objects.
   */
  private sync() {
    const { selectedIds: ids, currentRevision: revision } = this.editor;
    const id = this.editor.selection;
    const target = id ? this.editor.getObject(id) : undefined;

    const objectMode = this.view.objectMode?.() ?? true;
    if (
      this.outlinedFor?.ids !== ids ||
      this.outlinedFor.revision !== revision ||
      this.outlinedFor.objectMode !== objectMode
    ) {
      this.outlinedFor = { ids, revision, objectMode };
      this.viewport.setOutlinedObjects(
        objectMode ? ids.flatMap((selectedId) => this.editor.getObject(selectedId) ?? []) : [],
      );
    }

    const tool = this.view.tool();
    const enabled = this.view.enabled();
    if (isHandleTool(tool) && HANDLE_MODES[tool] !== this.mode) {
      this.mode = HANDLE_MODES[tool];
      this.controls.setMode(this.mode);
    }
    const showGizmo = Boolean(target) && enabled && isHandleTool(tool);
    this.controls.getHelper().visible = showGizmo;
    this.controls.enabled = showGizmo;
    if (this.controls.dragging) return;
    if (target && showGizmo) {
      let holder = target;
      if (ids.length > 1) {
        this.placePivot();
        holder = this.pivot;
      }
      if (this.controls.object !== holder) this.controls.attach(holder);
    } else {
      this.controls.detach();
    }

    this.origin.visible = objectMode && Boolean(target);
    if (target) target.getWorldPosition(this.origin.position);
  }
}
