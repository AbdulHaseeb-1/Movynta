import { Object3D, type Bone } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { EditorScene, ObjectTransform } from "@/features/assistant";
import {
  bindShiftSnap,
  HANDLE_MODES,
  isHandleTool,
  pickObjectId,
  sameTransform,
  styleHandles,
  toNdc,
  type HandleMode,
} from "@/features/objectEditing";
import { watchClicks, type Viewport, type ViewportTool } from "@/features/viewport3d";
import { pickBone } from "./boneHit";
import type { BoneRef, BoneSelection } from "./BoneSelection";
import { chainAbove, solveChain } from "./ikSolver";
import type { RigOverlay } from "./RigOverlay";
import { boneAt, poseOf, rigOf, type Rig } from "./rig";

const GIZMO_SIZE = 0.62;

/** What the gizmo asks of its owner on every frame, so it never works from a stale copy. */
export interface BoneGizmoView {
  tool: () => ViewportTool;
  /** False while the assistant works, which turns the handles off. */
  enabled: () => boolean;
  /** True while the user is posing: only then do handles appear on the selected bone. */
  posing: () => boolean;
  /** How many bones above a joint bend when it is dragged with Move. Zero drags the joint alone. */
  ikChain: () => number;
}

/** A bone a drag moved: where it was and where it is now. */
export interface BoneChange {
  ref: BoneRef;
  before: ObjectTransform;
  after: ObjectTransform;
}

export interface BoneGizmoEvents {
  /** The user is dragging a handle: the selected bone's current transform. */
  onLiveChange: (change: { ref: BoneRef; transform: ObjectTransform }) => void;
  /** A drag ended: every bone it moved, with where each was and is. */
  onCommit: (changes: BoneChange[]) => void;
  /** A click landed on a joint and selected its bone, so posing should start. */
  onPick: () => void;
}

/** A bone that a drag moves, with the pose it started from. */
interface Dragged {
  ref: BoneRef;
  bone: Bone;
  before: ObjectTransform;
}

/**
 * Everything the user does with the mouse on a rig: clicking a joint or stick to select a bone (which
 * starts posing, so a rig that is shown can always be grabbed), and the handles on the selected bone.
 * Rotate and Scale turn and size the bone, and everything below it follows, as in any skeleton. Move
 * drags the joint itself: with a chain length above zero the bones above it bend to follow, so pulling
 * a hand brings the arm with it. The selected object and its bones are read on every frame, so a
 * model the scene has replaced with a copy is followed without extra wiring.
 */
export class BoneGizmo {
  private readonly viewport: Viewport;
  private readonly editor: EditorScene;
  private readonly overlay: RigOverlay;
  private readonly selection: BoneSelection;
  private readonly events: BoneGizmoEvents;
  private readonly view: BoneGizmoView;
  private readonly controls: TransformControls;
  private readonly cleanups: (() => void)[] = [];
  /** What the Move handles hold on to while a chain bends to follow it. It is not part of the scene. */
  private readonly target = new Object3D();
  private mode: HandleMode | undefined;
  private dragged: Dragged[] = [];
  /** The bone being pulled and the bones that bend with it, while a chain is dragged. */
  private pulling: { effector: Bone; chain: Bone[] } | undefined;

  constructor(
    viewport: Viewport,
    editor: EditorScene,
    overlay: RigOverlay,
    selection: BoneSelection,
    events: BoneGizmoEvents,
    view: BoneGizmoView,
  ) {
    this.viewport = viewport;
    this.editor = editor;
    this.overlay = overlay;
    this.selection = selection;
    this.events = events;
    this.view = view;
    const dom = viewport.renderer.domElement;

    this.controls = new TransformControls(viewport.camera, dom);
    styleHandles(this.controls, GIZMO_SIZE);
    viewport.scene.add(this.controls.getHelper());
    viewport.scene.add(this.target);

    // While a handle is dragged the camera must stay put.
    const onDragging = (event: { value?: unknown }) => {
      const dragging = event.value === true;
      viewport.controls.enabled = !dragging;
      if (dragging) this.beginDrag();
      else this.endDrag();
    };
    const onObjectChange = () => {
      if (this.pulling) solveChain(this.pulling.effector, this.pulling.chain, this.target.position);
      const bone = this.selectedBone();
      if (bone) this.events.onLiveChange({ ref: bone.ref, transform: poseOf(bone.bone) });
    };
    this.controls.addEventListener("dragging-changed", onDragging);
    this.controls.addEventListener("objectChange", onObjectChange);

    const stopClicks = watchClicks(dom, {
      // A press on a handle drags it; it is never a click on the scene.
      ignore: () => this.controls.axis !== null,
      // Heard first, so a click on a joint is not also a click on the model behind it.
      capture: true,
      onClick: (event) => {
        if (!this.view.enabled() || this.view.tool() === "pan") return;
        const bounds = dom.getBoundingClientRect();
        const ndc = toNdc(event.clientX, event.clientY, bounds);
        if (this.pickJoint(ndc, bounds)) {
          // Claimed, so the click is not also one on the model behind the joint.
          event.preventDefault();
          this.events.onPick();
        } else if (this.view.posing()) {
          this.pickElsewhere(ndc);
        }
      },
    });

    this.cleanups.push(
      () => this.controls.removeEventListener("dragging-changed", onDragging),
      () => this.controls.removeEventListener("objectChange", onObjectChange),
      stopClicks,
      bindShiftSnap(this.controls),
      viewport.addFrameListener(() => this.sync()),
    );
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.viewport.controls.enabled = true;
    this.controls.detach();
    this.viewport.scene.remove(this.controls.getHelper());
    this.viewport.scene.remove(this.target);
    this.controls.dispose();
  }

  /** The selected bone and where to find it now, or undefined when nothing is selected. */
  private selectedBone(): { ref: BoneRef; bone: Bone; rig: Rig } | undefined {
    const ref = this.selection.selected;
    const object = ref ? this.editor.getObject(ref.objectId) : undefined;
    const rig = object ? rigOf(object) : undefined;
    const bone = ref && rig ? boneAt(rig, ref.bone) : undefined;
    return ref && rig && bone ? { ref, bone, rig } : undefined;
  }

  /** The bones that bend when the selected bone is pulled with Move, nearest first. */
  private chainOfSelected(): Bone[] {
    const selected = this.selectedBone();
    return selected ? chainAbove(selected.rig, selected.ref.bone, this.view.ikChain()) : [];
  }

  /** Remembers where the bones are before a handle moves them. */
  private beginDrag(): void {
    const selected = this.selectedBone();
    if (!selected) return;
    this.dragged = [];
    if (this.controls.object === this.target) {
      const chain = this.chainOfSelected();
      this.pulling = { effector: selected.bone, chain };
      // The bones that bend are the ones above the pulled bone, which itself only follows.
      for (const bone of chain) {
        const index = selected.rig.bones.indexOf(bone);
        if (index >= 0)
          this.dragged.push({ ref: { objectId: selected.ref.objectId, bone: index }, bone, before: poseOf(bone) });
      }
      return;
    }
    this.dragged = [{ ref: selected.ref, bone: selected.bone, before: poseOf(selected.bone) }];
  }

  /** Reports what the drag changed, if anything. */
  private endDrag(): void {
    const changes: BoneChange[] = [];
    for (const { ref, bone, before } of this.dragged) {
      const after = poseOf(bone);
      if (!sameTransform(before, after)) changes.push({ ref, before, after });
    }
    this.dragged = [];
    this.pulling = undefined;
    if (changes.length > 0) this.events.onCommit(changes);
  }

  /**
   * Selects the bone under a click, among every rig that is drawn, the selected model's first. Selecting
   * a bone of another model selects that model too. Returns whether the click landed on a joint or stick.
   */
  private pickJoint(ndc: ReturnType<typeof toNdc>, bounds: DOMRect): boolean {
    const selectedId = this.editor.selection;
    const rigs = this.overlay
      .visibleRigs()
      .sort((a, b) => Number(b.objectId === selectedId) - Number(a.objectId === selectedId));
    for (const { objectId, rig, joints } of rigs) {
      const bone = pickBone(rig, joints, this.viewport.camera, ndc, bounds.width, bounds.height);
      if (bone === undefined) continue;
      // Choosing another model clears the bone, so the model comes first.
      if (objectId !== selectedId) this.editor.select(objectId);
      this.selection.select({ objectId, bone });
      return true;
    }
    return false;
  }

  /** While posing, a click away from every joint selects another model, or lets go of the bone. */
  private pickElsewhere(ndc: ReturnType<typeof toNdc>): void {
    const objectId = this.editor.selection;
    const other = pickObjectId(this.editor, this.viewport.camera, ndc);
    if (other !== undefined && other !== objectId) this.editor.select(other);
    else this.selection.select(undefined);
  }

  private sync(): void {
    const tool = this.view.tool();
    const enabled = this.view.enabled();
    if (isHandleTool(tool) && HANDLE_MODES[tool] !== this.mode) {
      this.mode = HANDLE_MODES[tool];
      this.controls.setMode(this.mode);
    }
    const selected = this.view.posing() && enabled && isHandleTool(tool) ? this.selectedBone() : undefined;
    this.controls.getHelper().visible = Boolean(selected);
    this.controls.enabled = Boolean(selected);
    if (this.controls.dragging) return;
    if (!selected) {
      if (this.controls.object) this.controls.detach();
      return;
    }
    // Move pulls the joint itself when bones above it can bend with it; otherwise it moves the bone.
    const pulls = tool === "move" && this.chainOfSelected().length > 0;
    if (pulls) selected.bone.getWorldPosition(this.target.position);
    const holder = pulls ? this.target : selected.bone;
    if (this.controls.object !== holder) this.controls.attach(holder);
  }
}
