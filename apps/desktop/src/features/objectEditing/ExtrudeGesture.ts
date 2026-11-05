import {
  DoubleSide,
  Euler,
  Quaternion,
  SkinnedMesh,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type Mesh,
} from "three";
import { MAX_SELECTED_BEVEL_SEGMENTS } from "@movynta/editor-protocol";
import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import {
  parseFaces,
  checkExtrudeSelection,
  extrudeAlongRegionNormal,
  extrudeRegion,
  regionNormal,
  writeExtrudedGeometry,
  ZeroAreaWallError,
  type ExtrudeKind,
} from "@/features/meshGeometry/meshExtrude";
import { insetFaces, type InsetOptions } from "@/features/meshGeometry/meshInset";
import { prepareBevelPreview } from "@/features/meshGeometry/meshBevel";
import {
  readTopology,
  faceNormal,
  type PolygonMesh,
} from "@/features/meshGeometry/meshTopology";
import { faceTransformSelection, transformFaces, type FaceTransform } from "@/features/meshGeometry/meshFaceTransform";
import { ExtrudeFacePreview } from "@/features/meshGeometry/extrudeFacePreview";
import { FaceTransformPreview } from "@/features/meshGeometry/faceTransformPreview";
import { ExtrudePreviewOverlay } from "./ExtrudePreviewOverlay";

type Axis = "x" | "y" | "z";
type ExtrudeMode = "move" | "scale" | "rotate";
export type FaceTool = ExtrudeMode | "extrude" | "normals" | "individual" | "solid" | "inset" | "bevel";
interface CapShape { capScale?: number; twistDegrees?: number; capRotationDegrees?: number[] }
const AXIS = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};
let active = false;
let previewMesh: Mesh | null = null;

/** True while E has started an extrude grab, so Escape can cancel that grab. */
export function extrudeIsActive(): boolean {
  return active;
}
export function extrudeHasPreview(mesh: Mesh): boolean {
  return previewMesh === mesh;
}

export interface ExtrudeTarget {
  objectId: string;
  meshPath: number[];
  kind: ExtrudeKind;
  ids: readonly string[];
}
export interface ExtrudeCommit {
  objectId: string;
  meshPath: number[];
  kind: ExtrudeKind;
  ids: string[];
  offset: [number, number, number];
  selection: string[];
  /** The scene revision the preview was computed on. The ids are only valid for that revision. */
  revision: number;
  shape?: CapShape;
  normalDistance?: number;
  normalMode?: "vertex" | "individual";
  closeOpenSurface?: true;
}
export type FaceTransformCommit = Pick<ExtrudeCommit, "objectId" | "meshPath" | "ids" | "selection" | "revision"> & {
  transform: FaceTransform;
};
export type InsetCommit = Pick<ExtrudeCommit, "objectId" | "meshPath" | "ids" | "selection" | "revision"> & {
  options: InsetOptions;
};
export type BevelCommit = Pick<ExtrudeCommit, "objectId" | "meshPath" | "ids" | "selection" | "revision"> & { width: number; segments: number };
export interface ConfirmedPreview { show: () => void; dispose: () => void }
interface InsetSession {
  options: InsetOptions;
  depthMode: boolean;
  numeric: string;
}
const insetToggles = {
  b: "boundary", e: "offsetEven", l: "offsetRelative", r: "edgeRail",
  o: "outset", i: "individual", s: "selectOuter", u: "interpolate",
} as const;
function insetToggle(key: string): (typeof insetToggles)[keyof typeof insetToggles] | undefined {
  return Object.entries(insetToggles).find(([shortcut]) => shortcut === key)?.[1];
}
function insetHint(inset: InsetSession): string {
  const options = inset.options;
  const toggles = [
    `I ${options.individual ? "Individual" : "Region"}`, `O ${options.outset ? "Outset" : "Inset"}`,
    `B Boundary ${options.boundary ? "on" : "off"}`, `E Even ${options.offsetEven ? "on" : "off"}`,
    `L Relative ${options.offsetRelative ? "on" : "off"}`, `R Rail ${options.edgeRail ? "on" : "off"}`,
    `S Select ${options.selectOuter ? "border" : "inside"}`, `U Interpolate ${options.interpolate ? "on" : "off"}`,
  ];
  const amount = (key: "thickness" | "depth") => (
    (key === "depth") === inset.depthMode && inset.numeric !== "" ? inset.numeric : (options[key] ?? 0).toPrecision(4)
  );
  return `Thickness ${amount("thickness")} · Depth ${amount("depth")} · Move or type a value · Ctrl or D for depth · ${toggles.join(" · ")} · Enter confirm · Esc cancel`;
}
interface Session {
  mesh: Mesh;
  original: BufferGeometry;
  cage: PolygonMesh;
  kind: ExtrudeKind;
  ids: string[];
  objectId: string;
  meshPath: number[];
  origin: Vector3;
  axis: Axis | null;
  mode: ExtrudeMode;
  tool: FaceTool;
  normal: Vector3 | null;
  useNormal: boolean;
  normalDistance: number;
  faceSelection: ReturnType<typeof faceTransformSelection> | null;
  transform: FaceTransform | null;
  inset: InsetSession | null;
  bevel: { width: number; segments: number; numeric: string; preview: ReturnType<typeof prepareBevelPreview> } | null;
  shape: CapShape;
  shapeBase: CapShape;
  moveBase: Vector3;
  start: Vector2 | null;
  current: Vector2 | null;
  revision: number;
  cameraEnabled: boolean;
  preview: BufferGeometry | null;
  facePreview: ExtrudeFacePreview | null;
  transformPreview: FaceTransformPreview | null;
  overlay: ExtrudePreviewOverlay | null;
  offset: Vector3 | null;
  selection: string[] | null;
  /** Why the pointer's current offset cannot be built. The last valid preview stays on screen and is what confirm keeps. */
  blocked: string | null;
  restoreMaterial: () => void;
}
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
function grabWorldDelta(
  camera: Camera,
  rect: DOMRect,
  origin: Vector3,
  start: Vector2,
  current: Vector2,
  axis: Vector3 | null,
): Vector3 {
  const delta = current.clone().sub(start);
  const projected = origin.clone().project(camera);
  if (axis) {
    const tip = origin.clone().add(axis).project(camera);
    const screen = new Vector2(
      ((tip.x - projected.x) * rect.width) / 2,
      (-(tip.y - projected.y) * rect.height) / 2,
    );
    const amount =
      screen.lengthSq() < 4
        ? delta.x / 100
        : delta.dot(screen) / screen.lengthSq();
    return axis.clone().multiplyScalar(amount);
  }
  const target = new Vector3(
    projected.x + (delta.x * 2) / rect.width,
    projected.y - (delta.y * 2) / rect.height,
    projected.z,
  ).unproject(camera);
  return target.sub(origin);
}
function toLocalOffset(mesh: Mesh, worldDelta: Vector3): Vector3 {
  mesh.updateWorldMatrix(true, false);
  const origin = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
  const moved = origin.clone().add(worldDelta);
  mesh.worldToLocal(origin);
  mesh.worldToLocal(moved);
  return moved.sub(origin);
}
function faceGestureTransform(
  mode: ExtrudeMode, camera: Camera, rect: DOMRect, origin: Vector3,
  start: Vector2, current: Vector2, axis: Vector3 | null,
): FaceTransform | null {
  if (mode === "move") {
    const move = grabWorldDelta(camera, rect, origin, start, current, axis);
    return move.lengthSq() > 1e-12 ? { position: move.toArray() } : null;
  }
  const projected = origin.clone().project(camera);
  const center = new Vector2(rect.left + (projected.x + 1) * rect.width / 2, rect.top + (1 - projected.y) * rect.height / 2);
  const from = start.clone().sub(center);
  const to = current.clone().sub(center);
  const delta = (current.x - start.x) - (current.y - start.y);
  if (mode === "scale") {
    const factor = Math.min(100, Math.max(0.001, from.length() < 8 ? Math.exp(delta / 150) : to.length() / from.length()));
    if (Math.abs(factor - 1) < 1e-8) return null;
    return { scale: axis ? new Vector3(1, 1, 1).addScaledVector(axis, factor - 1).toArray() : [factor, factor, factor] };
  }
  const direction = axis ?? camera.getWorldDirection(new Vector3()).negate();
  const angle = from.length() < 8 || to.length() < 8
    ? delta * Math.PI / 360 : -Math.atan2(from.cross(to), from.dot(to));
  if (Math.abs(angle) < 1e-8) return null;
  const euler = new Euler().setFromQuaternion(new Quaternion().setFromAxisAngle(direction, angle));
  return { rotation: [euler.x, euler.y, euler.z] };
}
function componentOrigin(
  mesh: Mesh,
  cage: PolygonMesh,
  kind: ExtrudeKind,
  ids: readonly string[],
): Vector3 {
  const local = new Vector3();
  let count = 0;
  const add = (index: number) => {
    const position = cage.positions[index];
    if (!position) return;
    local.add(position);
    count += 1;
  };
  if (kind === "vertex") for (const id of ids) add(Number(id));
  else if (kind === "edge")
    for (const id of ids)
      id.split("_").forEach((vertex) => add(Number(vertex)));
  else
    for (const id of ids)
      for (const vertex of cage.faces[Number(id)] ?? []) add(vertex);
  if (count > 0) local.multiplyScalar(1 / count);
  return mesh.localToWorld(local);
}
function revealBackfaces(mesh: Mesh): () => void {
  const materials: Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  const previous = materials.map((material) => material.side);
  for (const material of materials) {
    material.side = DoubleSide;
    material.needsUpdate = true;
  }
  return () => {
    materials.forEach((material, index) => {
      const side = previous[index];
      if (side === undefined) return;
      material.side = side;
      material.needsUpdate = true;
    });
  };
}
function hint(session: Session): string {
  const transforming = session.faceSelection !== null;
  const mode = transforming ? `${session.mode[0]?.toUpperCase() ?? ""}${session.mode.slice(1)} faces`
    : session.mode === "scale" ? "Scale cap" : session.mode === "rotate" ? "Rotate cap"
    : session.tool === "normals" ? "Extrude along normals" : session.tool === "individual" ? "Extrude individual faces"
    : session.tool === "solid" ? "Extrude solid sheet" : "Extrude";
  const special = session.tool === "individual" || session.tool === "normals" || session.tool === "solid";
  const controls = session.kind === "face" && session.offset?.lengthSq()
    ? "G move · S scale · R rotate · X/Y/Z set axis"
    : special ? "Move pointer to set distance" : "X/Y/Z constrain";
  return `${mode}${session.axis ? ` · ${session.axis.toUpperCase()}` : ""}  ·  ${controls}  ·  Click or Enter confirm  ·  Esc cancel`;
}

/** Edit-mode E: extrude the region, then grab it with the same axis keys as G. */
export class ExtrudeGesture {
  readonly start: (tool: FaceTool) => void;
  private session: Session | undefined;
  private pointer: Vector2 | null = null;
  private readonly cleanups: (() => void)[] = [];
  constructor(
    viewport: Viewport,
    editor: EditorScene,
    enabled: () => boolean,
    editing: () => boolean,
    target: () => ExtrudeTarget | null,
    onCommit: (commit: ExtrudeCommit, preview?: ConfirmedPreview) => void,
    onError: (error: unknown) => void,
    status: (text: string) => void,
    onTransform?: (commit: FaceTransformCommit, preview?: ConfirmedPreview) => void,
    onInset?: (commit: InsetCommit, preview?: ConfirmedPreview) => void,
    onBevel?: (commit: BevelCommit, preview?: ConfirmedPreview) => void,
    holdConfirmedPreview = false,
  ) {
    const dom = viewport.renderer.domElement;
    let pendingMove = false;
    let pendingPreview: ConfirmedPreview | undefined;
    const restore = () => {
      const session = this.session;
      if (!session) return;
      // Undo only our own preview. If another edit has replaced the displayed geometry, that result stays.
      if (session.preview && session.mesh.geometry === session.preview)
        session.mesh.geometry = session.original;
      session.overlay?.dispose();
      session.overlay = null;
      if (previewMesh === session.mesh) previewMesh = null;
      session.preview?.dispose();
      session.preview = null;
      session.facePreview = null;
      session.transformPreview = null;
    };
    const stop = (session: Session) => {
      restore();
      session.restoreMaterial();
      this.session = undefined;
      active = false;
      pendingMove = false;
      viewport.controls.enabled = session.cameraEnabled;
      status("");
    };
    const end = (confirmed: boolean) => {
      const session = this.session;
      if (!session) return;
      const valid = confirmed && live(session) && !session.blocked;
      const offset = session.offset;
      const selection = session.selection;
      const faceCommit = valid && session.transform && selection ? {
        objectId: session.objectId, meshPath: session.meshPath, ids: session.ids,
        selection, revision: session.revision, transform: session.transform,
      } : null;
      const insetCommit = valid && session.inset && selection ? {
        objectId: session.objectId, meshPath: session.meshPath, ids: session.ids,
        selection, revision: session.revision, options: session.inset.options,
      } : null;
      const bevelCommit = valid && session.bevel && selection && session.bevel.width > 0 ? {
        objectId: session.objectId, meshPath: session.meshPath, ids: session.ids,
        selection, revision: session.revision, width: session.bevel.width, segments: session.bevel.segments,
      } : null;
      const commit =
        valid && offset && selection && offset.lengthSq() > 1e-12
          ? {
              objectId: session.objectId,
              meshPath: session.meshPath,
              kind: session.kind,
              ids: session.ids,
              offset: [offset.x, offset.y, offset.z] as [
                number,
                number,
                number,
              ],
              selection,
              revision: session.revision,
              ...(Object.keys(session.shape).length ? { shape: session.shape } : {}),
              ...(session.tool === "normals" ? { normalMode: "vertex" as const, normalDistance: session.normalDistance } : {}),
              ...(session.tool === "individual" ? { normalMode: "individual" as const, normalDistance: session.normalDistance } : {}),
              ...(session.tool === "solid" ? { closeOpenSurface: true as const, normalDistance: session.normalDistance } : {}),
            }
          : null;
      const geometry = holdConfirmedPreview && (commit || faceCommit || insetCommit || bevelCommit) ? session.preview : null;
      if (geometry) { session.preview = null; session.mesh.geometry = session.original; }
      stop(session);
      let preview: ConfirmedPreview | undefined;
      if (geometry) {
        let disposed = false;
        const hide = () => { if (session.mesh.geometry === geometry) session.mesh.geometry = session.original; };
        const unsubscribe = editor.onBeforeChange(() => {
          hide();
          // Inspections and forks need the committed cage; restore the visual after their synchronous read.
          queueMicrotask(() => preview?.show());
        });
        active = true; previewMesh = session.mesh;
        preview = {
          show: () => { if (!disposed && editor.currentRevision === session.revision && session.mesh.geometry === session.original) session.mesh.geometry = geometry; },
          dispose: () => { if (disposed) return; disposed = true; unsubscribe(); hide(); geometry.dispose(); active = false; if (previewMesh === session.mesh) previewMesh = null; pendingPreview = undefined; },
        };
        pendingPreview = preview;
        preview.show();
      }
      if (commit) onCommit(commit, preview);
      if (faceCommit) onTransform?.(faceCommit, preview);
      if (insetCommit) onInset?.(insetCommit, preview);
      if (bevelCommit) onBevel?.(bevelCommit, preview);
    };
    const updateBevel = (session: Session) => {
      const bevel = session.bevel;
      if (!bevel) return;
      const entered = Number(bevel.numeric);
      session.blocked = bevel.numeric !== "" && !Number.isFinite(entered) ? "Finish entering a number"
        : bevel.numeric !== "" && entered > 100 ? "Width must be at most 100" : null;
      if (!session.blocked && bevel.width === 0) { restore(); session.selection = null; }
      else if (!session.blocked) {
        try {
          const mesh = bevel.preview(bevel.width, bevel.segments);
          showPreview(session, { mesh, selection: [], walls: [] });
        } catch (error) { session.blocked = error instanceof Error ? error.message : "Bevel preview failed"; }
      }
      status(`Bevel · Width ${bevel.numeric || bevel.width.toPrecision(4)} · Segments ${bevel.segments} · Move or type · Wheel segments · Enter confirm · Esc cancel${session.blocked ? ` · ${session.blocked}` : ""}`);
    };
    const updateInset = (session: Session, inset: InsetSession) => {
      session.blocked = inset.numeric !== "" && !Number.isFinite(Number(inset.numeric))
        ? "Finish entering a number" : null;
      if (session.blocked) {
        status(`${insetHint(inset)} · ${session.blocked}`);
        return;
      }
      if (inset.options.thickness === 0 && !inset.options.depth) {
        restore();
        session.selection = null;
      } else {
        try {
          showPreview(session, insetFaces(session.cage, session.ids, inset.options));
        } catch (error) {
          session.blocked = error instanceof Error ? error.message : "Inset preview failed";
        }
      }
      status(session.blocked ? `${insetHint(inset)} · ${session.blocked}` : insetHint(inset));
    };
    const update = () => {
      const session = this.session;
      if (session?.bevel) { updateBevel(session); return; }
      if (session?.inset) {
        updateInset(session, session.inset);
        return;
      }
      if (!session || !session.start || !session.current) return;
      const rect = dom.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      try {
        const delta = session.current.x - session.start.x - (session.current.y - session.start.y);
        const axis = session.axis ? AXIS[session.axis] : null;
        const worldNormal = session.useNormal && session.normal
          ? session.normal.clone().transformDirection(session.mesh.matrixWorld) : null;
        if (session.faceSelection) {
          const transform = faceGestureTransform(session.mode, viewport.camera, rect, session.origin, session.start, session.current, axis);
          if (!transform) {
            restore();
            session.transform = null;
            session.blocked = null;
            return;
          }
          const result = transformFaces(session.cage, session.ids, transform, session.mesh.matrixWorld, session.faceSelection);
          if (session.transformPreview) {
            session.transformPreview.update(result);
            session.overlay?.update();
          } else if (Object.values(session.original.morphAttributes).every((targets) => !targets?.length)) {
            const prepared = new FaceTransformPreview(session.original, result, session.faceSelection.vertices);
            showPreview(session, result, prepared);
            session.transformPreview = prepared;
          } else {
            showPreview(session, result);
          }
          session.transform = transform;
          session.blocked = null;
          return;
        }
        const offset = session.mode !== "move" && session.offset ? session.offset : toLocalOffset(
          session.mesh,
          grabWorldDelta(
            viewport.camera,
            rect,
            session.origin,
            session.start,
            session.current,
            axis ?? worldNormal,
          ),
        ).add(session.moveBase);
        const shape = { ...session.shapeBase };
        if (session.mode === "scale") {
          shape.capScale = Math.min(100, Math.max(0.01, (shape.capScale ?? 1) * Math.exp(delta / 180)));
        } else if (session.mode === "rotate" && axis) {
          const previous = shape.capRotationDegrees ?? [0, 0, 0];
          const r = Math.PI / 180;
          const orientation = new Quaternion().setFromAxisAngle(axis, delta * r / 2)
            .multiply(new Quaternion().setFromEuler(new Euler((previous[0] ?? 0) * r, (previous[1] ?? 0) * r, (previous[2] ?? 0) * r)));
          const euler = new Euler().setFromQuaternion(orientation);
          shape.capRotationDegrees = [euler.x / r, euler.y / r, euler.z / r].map((angle) => Math.max(-180, Math.min(180, angle)));
        } else if (session.mode === "rotate") {
          shape.twistDegrees = Math.min(180, Math.max(-180, (shape.twistDegrees ?? 0) + delta * 0.5));
        }
        const shaped = Object.keys(shape).length > 0;
        const special = session.tool === "individual" || session.tool === "normals" || session.tool === "solid";
        const distance = session.normal ? offset.dot(session.normal) : 0;
        if (offset.lengthSq() <= 1e-12) {
          restore();
          session.offset = offset;
          session.selection = null;
          session.blocked = null;
        } else {
          try {
            if (session.facePreview && !shaped) {
              session.facePreview.update(offset);
              session.overlay?.update();
            } else {
              const result = special ? extrudeAlongRegionNormal(session.cage, session.ids, distance, {
                ...shape,
                ...(session.tool === "individual" ? { normalMode: "individual" } : {}),
                ...(session.tool === "normals" ? { normalMode: "vertex" } : {}),
                ...(session.tool === "solid" ? { closeOpenSurface: true } : {}),
              }) : extrudeRegion(
                session.cage,
                session.kind,
                session.ids,
                offset,
                shaped ? shape : undefined,
              );
              const supportsReuse =
                session.kind === "face" && !shaped && !special &&
                Object.values(session.original.morphAttributes).every(
                  (targets) => !targets?.length,
                );
              const supportsShapedReuse = session.kind === "face" && (shaped || special) && session.tool !== "solid" &&
                Object.values(session.original.morphAttributes).every((targets) => !targets?.length);
              if (supportsShapedReuse && session.transformPreview) {
                session.transformPreview.update(result);
                session.overlay?.update();
              } else if (supportsShapedReuse) {
                const vertices = new Set(result.selection.flatMap((id) => result.mesh.faces[Number(id)] ?? []));
                const prepared = new FaceTransformPreview(session.original, result, vertices);
                showPreview(session, result, prepared);
                session.transformPreview = prepared;
              } else {
                const facePreview = supportsReuse ? new ExtrudeFacePreview(session.original, result, offset) : null;
                showPreview(session, result, facePreview);
              }
            }
            session.offset = offset;
            session.normalDistance = distance;
            session.shape = shape;
            session.blocked = null;
          } catch (error) {
            if (!(error instanceof ZeroAreaWallError) && !(shaped && session.preview && error instanceof Error)) throw error;
            // A grab along an edge is not a failure. Keep the last valid preview and say why it did not follow.
            session.blocked = error.message;
          }
        }
        status(
          session.blocked
            ? `${hint(session)}  ·  ${session.blocked}`
            : hint(session),
        );
      } catch (error) {
        if (this.session?.faceSelection && this.session.preview && error instanceof Error) {
          this.session.blocked = error.message;
          status(`${hint(this.session)} · ${error.message}`);
          return;
        }
        if (this.session) stop(this.session);
        onError(error);
      }
    };
    const showPreview = (session: Session, result: ReturnType<typeof extrudeRegion>, prepared: ExtrudeFacePreview | FaceTransformPreview | null = null) => {
      const preview = prepared?.geometry ?? writeExtrudedGeometry(session.original, result);
      let overlay: ExtrudePreviewOverlay;
      try {
        overlay = new ExtrudePreviewOverlay(viewport.scene, session.mesh, result, session.kind);
      } catch (error) {
        preview.dispose();
        throw error;
      }
      session.overlay?.dispose();
      session.preview?.dispose();
      session.facePreview = prepared instanceof ExtrudeFacePreview ? prepared : null;
      session.overlay = overlay;
      session.preview = preview;
      session.mesh.geometry = preview;
      previewMesh = session.mesh;
      session.selection = result.selection;
    };
    const flush = () => {
      if (!pendingMove) return;
      pendingMove = false;
      update();
    };
    const live = (session: Session) => {
      const current = session.bevel ? target() : null;
      const selectionMatches = !session.bevel || (current?.objectId === session.objectId && current.kind === "edge" &&
        current.meshPath.length === session.meshPath.length && current.meshPath.every((part, index) => part === session.meshPath[index]) &&
        current.ids.length === session.ids.length && current.ids.every((id, index) => id === session.ids[index]));
      return selectionMatches && enabled() && editing() && editor.selection === session.objectId &&
        editor.currentRevision === session.revision &&
        (session.mesh.geometry === session.original || session.mesh.geometry === session.preview);
    };
    this.start = (tool) => {
      if (!enabled() || !editing() || this.session || pendingPreview) return;
      const selected = target();
      const transforming = tool === "move" || tool === "scale" || tool === "rotate";
      if (
        !selected ||
        selected.ids.length === 0 ||
        editor.selection !== selected.objectId ||
        (tool === "bevel" ? selected.kind !== "edge" : tool !== "extrude" && selected.kind !== "face")
      )
        return;
      try {
        const mesh = meshAtPath(
          editor.getObject(selected.objectId),
          selected.meshPath,
        );
        if (mesh instanceof SkinnedMesh)
          throw new Error("Component edits on skinned meshes are not supported yet.");
        if (
          (modifierStack(mesh)?.modifiers ?? []).some(
            (modifier) => modifier.enabled,
          )
        )
          throw new Error(
            "Disable modifiers before editing components, so the selection matches the base mesh",
          );
        const cage = readTopology(mesh.geometry);
        const faceSelection = transforming ? faceTransformSelection(cage, selected.ids) : null;
        const inset = tool === "inset" ? {
          options: { thickness: 0, depth: 0, boundary: true, offsetEven: true, interpolate: true },
          depthMode: false, numeric: "",
        } : null;
        const bevel = tool === "bevel" ? { width: 0, segments: 3, numeric: "", preview: prepareBevelPreview(cage, selected.ids) } : null;
        if (inset) parseFaces(cage, selected.ids);
        else if (!faceSelection && !bevel) checkExtrudeSelection(cage, selected.kind, selected.ids);
        let normal: Vector3 | null = null;
        if (!inset && !bevel && !transforming && selected.kind === "face") {
          try {
            normal = regionNormal(cage, selected.ids);
          } catch (error) {
            if (tool === "solid" || tool === "normals") throw error;
            if (tool === "individual") normal = faceNormal(cage, cage.faces[Number(selected.ids[0])] ?? []);
          }
        }
        mesh.updateWorldMatrix(true, false);
        this.session = {
          mesh,
          original: mesh.geometry,
          cage,
          kind: selected.kind,
          ids: [...selected.ids],
          objectId: selected.objectId,
          meshPath: [...selected.meshPath],
          origin: faceSelection ? mesh.localToWorld(faceSelection.pivot.clone()) : componentOrigin(mesh, cage, selected.kind, selected.ids),
          axis: null,
          mode: transforming ? tool : "move",
          tool,
          normal,
          useNormal: normal !== null,
          normalDistance: 0,
          faceSelection,
          transform: null,
          inset,
          bevel,
          shape: {},
          shapeBase: {},
          moveBase: new Vector3(),
          start: this.pointer?.clone() ?? null,
          current: this.pointer?.clone() ?? null,
          revision: editor.currentRevision,
          cameraEnabled: viewport.controls.enabled,
          preview: null,
          facePreview: null,
          transformPreview: null,
          overlay: null,
          offset: null,
          selection: null,
          blocked: null,
          restoreMaterial:
            selected.kind === "face" ? () => undefined : revealBackfaces(mesh),
        };
        active = true;
        viewport.controls.enabled = false;
        if (bevel) updateBevel(this.session);
        else status(inset ? insetHint(inset) : hint(this.session));
      } catch (error) {
        onError(error);
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        isTyping(event.target) ||
        (event.ctrlKey && !(event.key.toLowerCase() === "b" && !this.session) && !(this.session?.inset && (event.key === "Enter" || event.key === "Escape"))) ||
        event.metaKey ||
        event.altKey ||
        event.repeat
      )
        return;
      const key = event.key.toLowerCase();
      const session = this.session;
      if (!session && event.target instanceof HTMLElement && (event.target.closest('button, [role="menu"], [role="dialog"]'))) return;
      if (session) {
        if (session.bevel && key !== "escape" && key !== "enter") {
          if (!/^[0-9.]$/.test(key) && key !== "backspace") return;
          event.preventDefault(); event.stopImmediatePropagation(); flush();
          const value = key === "backspace" ? session.bevel.numeric.slice(0, -1) : session.bevel.numeric + key;
          if (/^\d*(\.\d*)?$/.test(value) && value.length <= 16) {
            session.bevel.numeric = value;
            if (value === "") session.bevel.width = 0;
            else if (Number.isFinite(Number(value)) && Number(value) <= 100) session.bevel.width = Number(value);
          }
          updateBevel(session); return;
        }
        const inset = session.inset;
        if (inset && key !== "escape" && key !== "enter") {
          const toggle = insetToggle(key);
          const numberKey = /^[0-9.-]$/.test(key) || key === "backspace";
          if (!toggle && !numberKey && key !== "d") return;
          event.preventDefault();
          event.stopImmediatePropagation();
          flush();
          if (toggle) {
            const toggledOn = !inset.options[toggle];
            inset.options = { ...inset.options, [toggle]: toggledOn };
            if (toggledOn && toggle === "outset") inset.options.individual = false;
            if (toggledOn && toggle === "individual") inset.options.outset = false;
          } else if (key === "d") {
            inset.depthMode = !inset.depthMode;
            inset.numeric = "";
          } else {
            const value = key === "backspace" ? inset.numeric.slice(0, -1) : inset.numeric + key;
            if (/^-?\d*(\.\d*)?$/.test(value) && value.length <= 16) {
              inset.numeric = value;
              const amount = Number(value);
              if (Number.isFinite(amount)) {
                if (inset.depthMode) inset.options = { ...inset.options, depth: amount };
                else inset.options = { ...inset.options, thickness: Math.max(0, amount) };
              }
            }
          }
          updateInset(session, inset);
          return;
        }
        if (
          !["escape", "enter", "x", "y", "z", "g", "s", "r", "e"].includes(key)
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === "escape") {
          pendingMove = false;
          end(false);
        } else if (key === "enter") {
          flush();
          if (!session.blocked) end(true);
        } else if ((key === "g" || key === "s" || key === "r") && session.kind === "face" && !session.faceSelection) {
          flush();
          if (this.session !== session) return;
          if (!session.offset || session.offset.lengthSq() <= 1e-12) {
            if (key === "g" && session.tool === "extrude") {
              session.useNormal = false;
              session.axis = null;
              update();
            }
            return;
          }
          session.mode = key === "g" ? "move" : key === "s" ? "scale" : "rotate";
          session.axis = null;
          session.useNormal = session.tool !== "extrude" && session.normal !== null;
          session.shapeBase = { ...session.shape };
          session.moveBase.copy(session.offset);
          session.start = this.pointer?.clone() ?? null;
          session.current = this.pointer?.clone() ?? null;
          session.blocked = null;
          status(hint(session));
        } else if (key === "x" || key === "y" || key === "z") {
          if (!session.faceSelection && (session.mode === "scale" || (session.mode === "move" && session.tool !== "extrude"))) return;
          session.axis = session.axis === key ? null : key;
          if (!session.faceSelection && session.mode === "move") session.useNormal = false;
          pendingMove = false;
          update();
          if (this.session === session && !session.blocked) status(hint(session));
        }
        return;
      }
      const tool = event.ctrlKey && key === "b" ? "bevel" : key === "e" ? "extrude" : key === "i" ? "inset" : key === "g" ? "move" : key === "r" ? "rotate" : key === "s" ? "scale" : null;
      if (!tool || !enabled() || !editing() || (tool === "bevel" ? target()?.kind !== "edge" : tool !== "extrude" && target()?.kind !== "face")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.start(tool);
    };
    const move = (event: PointerEvent) => {
      const previous = this.pointer;
      this.pointer = new Vector2(event.clientX, event.clientY);
      const session = this.session;
      if (!session) return;
      if (!live(session)) {
        end(false);
        return;
      }
      if (session.bevel) {
        if (previous) {
          const rect = dom.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const delta = this.pointer.clone().sub(previous);
          const worldPixel = grabWorldDelta(viewport.camera, rect, session.origin, new Vector2(), new Vector2(1, 0), null);
          const amount = (delta.x - delta.y) * toLocalOffset(session.mesh, worldPixel).length() * (event.shiftKey ? 0.1 : 1);
          if (amount === 0) return;
          session.bevel.numeric = "";
          session.bevel.width = Math.min(100, Math.max(0, session.bevel.width + amount));
          pendingMove = true;
        }
        return;
      }
      if (session.inset) {
        const inset = session.inset;
        if (previous && inset.numeric === "") {
          const rect = dom.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const delta = this.pointer.clone().sub(previous);
          const worldPixel = grabWorldDelta(viewport.camera, rect, session.origin, new Vector2(), new Vector2(1, 0), null);
          const amount = (delta.x - delta.y) * toLocalOffset(session.mesh, worldPixel).length();
          inset.options = event.ctrlKey || inset.depthMode
            ? { ...inset.options, depth: (inset.options.depth ?? 0) + amount }
            : { ...inset.options, thickness: Math.max(0, inset.options.thickness + amount) };
          pendingMove = true;
        }
        return;
      }
      session.start ??= this.pointer.clone();
      session.current = this.pointer.clone();
      pendingMove = true;
    };
    let blockContextMenu = false;
    const down = (event: PointerEvent) => {
      if (!this.session) return;
      if (typeof Element !== "undefined" && event.target instanceof Element && event.target !== dom) return;
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      blockContextMenu = event.button === 2;
      if (event.button === 0) flush();
      else pendingMove = false;
      if (event.button === 2 || !this.session?.blocked) end(event.button === 0);
    };
    const contextmenu = (event: MouseEvent) => {
      if (this.session || blockContextMenu) event.preventDefault();
      blockContextMenu = false;
    };
    const blur = () => end(false);
    const wheel = (event: WheelEvent) => {
      const session = this.session;
      if (!session?.bevel) return;
      if (typeof Element !== "undefined" && event.target instanceof Element && event.target !== dom) return;
      event.preventDefault(); event.stopImmediatePropagation(); flush();
      session.bevel.segments = Math.max(1, Math.min(MAX_SELECTED_BEVEL_SEGMENTS, session.bevel.segments + (event.deltaY < 0 ? 1 : -1)));
      updateBevel(session);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("contextmenu", contextmenu, true);
    window.addEventListener("blur", blur);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    const unsubscribe = editor.onChange(() => {
      if (this.session && !live(this.session))
        end(false);
    });
    // Ends the preview before another change or inspection reads the displayed geometry, so it sees the committed cage.
    const unsubscribeBefore = editor.onBeforeChange(() => {
      if (this.session) end(false);
    });
    const stopFrame = viewport.addFrameListener(() => {
      if (this.session && !live(this.session)) end(false);
      else flush();
    });
    this.cleanups.push(
      () => window.removeEventListener("keydown", keydown, true),
      () => window.removeEventListener("pointermove", move, true),
      () => window.removeEventListener("pointerdown", down, true),
      () => window.removeEventListener("contextmenu", contextmenu, true),
      () => window.removeEventListener("blur", blur),
      () => window.removeEventListener("wheel", wheel, true),
      unsubscribe,
      unsubscribeBefore,
      stopFrame,
      () => pendingPreview?.dispose(),
      () => end(false),
    );
  }
  dispose() {
    for (const cleanup of this.cleanups) cleanup();
  }
}
