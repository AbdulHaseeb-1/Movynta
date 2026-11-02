import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from "three";
import type { Viewport } from "@/features/viewport3d";
import { BoneWorld } from "./boneWorld";
import { SEGMENT_FLOATS, SEGMENT_VERTICES, writeBoneSegment } from "./boneShape";
import type { Rig } from "./rig";
import {
  BONE_COLOR,
  JOINT_COLOR,
  JOINT_SIZE_PX,
  OVERLAY_RENDER_ORDER,
  SELECTED_BONE_COLOR,
} from "./rigStyle";

/** One rig's drawing: its sticks and joints, and the buffers they are written into. */
class RigView {
  readonly rig: Rig;
  readonly world: BoneWorld;
  readonly group = new Group();
  private readonly sticks: Float32Array;
  private readonly stickColors: Float32Array;
  private readonly jointColors: Float32Array;
  private readonly stickPositions: BufferAttribute;
  private readonly stickColorAttribute: BufferAttribute;
  private readonly jointPositions: BufferAttribute;
  private readonly jointColorAttribute: BufferAttribute;
  /** The bone each stick belongs to: the one it hangs from, as its joint is the stick's head. */
  private readonly heads: Int32Array;
  private readonly tails: Int32Array;
  private readonly materials: (LineBasicMaterial | PointsMaterial)[] = [];
  private readonly geometries: BufferGeometry[] = [];

  constructor(rig: Rig) {
    this.rig = rig;
    this.world = new BoneWorld(rig);
    const sticks: number[] = [];
    rig.parents.forEach((parent, bone) => {
      if (parent >= 0) sticks.push(parent, bone);
    });
    const count = sticks.length / 2;
    this.heads = new Int32Array(count);
    this.tails = new Int32Array(count);
    for (let stick = 0; stick < count; stick += 1) {
      this.heads[stick] = sticks[stick * 2] ?? 0;
      this.tails[stick] = sticks[stick * 2 + 1] ?? 0;
    }

    this.sticks = new Float32Array(count * SEGMENT_FLOATS);
    this.stickColors = new Float32Array(count * SEGMENT_FLOATS);
    this.jointColors = new Float32Array(rig.bones.length * 3);
    this.stickPositions = new BufferAttribute(this.sticks, 3).setUsage(DynamicDrawUsage);
    this.stickColorAttribute = new BufferAttribute(this.stickColors, 3).setUsage(DynamicDrawUsage);
    this.jointPositions = new BufferAttribute(new Float32Array(rig.bones.length * 3), 3).setUsage(DynamicDrawUsage);
    this.jointColorAttribute = new BufferAttribute(this.jointColors, 3).setUsage(DynamicDrawUsage);

    const stickGeometry = new BufferGeometry();
    stickGeometry.setAttribute("position", this.stickPositions);
    stickGeometry.setAttribute("color", this.stickColorAttribute);
    const jointGeometry = new BufferGeometry();
    jointGeometry.setAttribute("position", this.jointPositions);
    jointGeometry.setAttribute("color", this.jointColorAttribute);
    this.geometries.push(stickGeometry, jointGeometry);

    const stickMaterial = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
    const jointMaterial = new PointsMaterial({
      vertexColors: true,
      size: JOINT_SIZE_PX,
      sizeAttenuation: false,
      depthTest: false,
    });
    this.materials.push(stickMaterial, jointMaterial);

    const lines = new LineSegments(stickGeometry, stickMaterial);
    const joints = new Points(jointGeometry, jointMaterial);
    for (const part of [lines, joints]) {
      part.renderOrder = OVERLAY_RENDER_ORDER;
      // The geometry is rewritten every frame, so its bounds are never right; it is always drawn.
      part.frustumCulled = false;
      // The drawing is not an object of the scene: a click cannot pick it and the assistant never sees it.
      part.raycast = () => undefined;
      this.group.add(part);
    }
    this.colorize(undefined);
  }

  /** Colors the selected bone, its joint and the sticks that run down from it. */
  colorize(selected: number | undefined): void {
    for (let bone = 0; bone < this.rig.bones.length; bone += 1) {
      const color = bone === selected ? SELECTED_BONE_COLOR : JOINT_COLOR;
      this.jointColors[bone * 3] = color.r;
      this.jointColors[bone * 3 + 1] = color.g;
      this.jointColors[bone * 3 + 2] = color.b;
    }
    for (let stick = 0; stick < this.heads.length; stick += 1) {
      const color = this.heads[stick] === selected ? SELECTED_BONE_COLOR : BONE_COLOR;
      for (let vertex = 0; vertex < SEGMENT_VERTICES; vertex += 1) {
        const at = stick * SEGMENT_FLOATS + vertex * 3;
        this.stickColors[at] = color.r;
        this.stickColors[at + 1] = color.g;
        this.stickColors[at + 2] = color.b;
      }
    }
    this.jointColorAttribute.needsUpdate = true;
    this.stickColorAttribute.needsUpdate = true;
  }

  /** Follows the bones to where they are now. */
  update(): void {
    this.world.update();
    const joints = this.world.positions;
    const target = this.jointPositions.array;
    for (let at = 0; at < joints.length; at += 1) target[at] = joints[at] ?? 0;
    for (let stick = 0; stick < this.heads.length; stick += 1)
      writeBoneSegment(this.sticks, stick * SEGMENT_FLOATS, joints, this.heads[stick] ?? 0, this.tails[stick] ?? 0);
    this.jointPositions.needsUpdate = true;
    this.stickPositions.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

/**
 * Draws the skeletons of the models in the scene on top of the view: a stick for each bone and a dot
 * for each joint, the selected bone in orange. It is a drawing only, not part of the scene, so it never
 * reaches the assistant or the saved project. The views are rebuilt only when the set of rigs changes;
 * each frame just moves the lines to where the bones are.
 */
export class RigOverlay {
  private readonly viewport: Viewport;
  private readonly root = new Group();
  private views = new Map<string, RigView>();
  private selected: { objectId: string; bone: number } | undefined;
  private readonly isVisible: () => boolean;
  private readonly stopFrames: () => void;

  /** `isVisible` is asked on every frame, so the overlay never works from a stale copy of the setting. */
  constructor(viewport: Viewport, isVisible: () => boolean) {
    this.viewport = viewport;
    this.isVisible = isVisible;
    viewport.scene.add(this.root);
    this.stopFrames = viewport.addFrameListener(() => this.update());
  }

  /** Shows the rigs given, by the id of the model each belongs to. A rig already shown is kept. */
  setRigs(rigs: ReadonlyMap<string, Rig>): void {
    const next = new Map<string, RigView>();
    for (const [id, rig] of rigs) {
      const known = this.views.get(id);
      if (known && known.rig === rig) {
        next.set(id, known);
        continue;
      }
      const view = new RigView(rig);
      view.colorize(this.selected?.objectId === id ? this.selected.bone : undefined);
      this.root.add(view.group);
      next.set(id, view);
    }
    for (const [id, view] of this.views) if (next.get(id) !== view) view.dispose();
    this.views = next;
  }

  /** Marks one bone as selected, or none. */
  setSelectedBone(selection: { objectId: string; bone: number } | undefined): void {
    this.selected = selection;
    for (const [id, view] of this.views) view.colorize(selection?.objectId === id ? selection.bone : undefined);
  }

  /** The rigs that are drawn now, with their joints as they were drawn last. None while the overlay is hidden. */
  visibleRigs(): { objectId: string; rig: Rig; joints: Float64Array }[] {
    if (!this.root.visible) return [];
    return [...this.views].map(([objectId, view]) => ({ objectId, rig: view.rig, joints: view.world.positions }));
  }

  /** The joints of a model's rig as they were drawn last, for finding what a click lands on. */
  jointsOf(objectId: string): Float64Array | undefined {
    return this.views.get(objectId)?.world.positions;
  }

  private update(): void {
    const visible = this.isVisible();
    this.root.visible = visible;
    if (!visible) return;
    for (const view of this.views.values()) view.update();
  }

  dispose(): void {
    this.stopFrames();
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    this.viewport.scene.remove(this.root);
  }
}
