import { DoubleSide, SkinnedMesh, Vector2, Vector3, type BufferGeometry, type Camera, type Material, type Mesh } from "three";
import type { EditorScene } from "@/features/assistant";
import type { Viewport } from "@/features/viewport3d";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { extrudeRegion, type ExtrudeKind } from "@/features/meshGeometry/meshExtrude";
import { writeShadedGeometry } from "@/features/meshGeometry/meshOutput";
import { readTopology, type PolygonMesh } from "@/features/meshGeometry/meshTopology";

type Axis = "x" | "y" | "z";
const AXIS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
let active = false;

/** True while E has started an extrude grab, so Escape can cancel that grab. */
export function extrudeIsActive(): boolean { return active; }

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
  start: Vector2 | null;
  current: Vector2 | null;
  revision: number;
  cameraEnabled: boolean;
  preview: BufferGeometry | null;
  offset: Vector3 | null;
  selection: string[] | null;
  restoreMaterial: () => void;
}
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
function grabWorldDelta(camera: Camera, rect: DOMRect, origin: Vector3, start: Vector2, current: Vector2, axis: Vector3 | null): Vector3 {
  const delta = current.clone().sub(start);
  const projected = origin.clone().project(camera);
  if (axis) {
    const tip = origin.clone().add(axis).project(camera);
    const screen = new Vector2(((tip.x - projected.x) * rect.width) / 2, (-(tip.y - projected.y) * rect.height) / 2);
    const amount = screen.lengthSq() < 4 ? delta.x / 100 : delta.dot(screen) / screen.lengthSq();
    return axis.clone().multiplyScalar(amount);
  }
  const target = new Vector3(projected.x + (delta.x * 2) / rect.width, projected.y - (delta.y * 2) / rect.height, projected.z).unproject(camera);
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
function componentOrigin(mesh: Mesh, cage: PolygonMesh, kind: ExtrudeKind, ids: readonly string[]): Vector3 {
  const local = new Vector3();
  let count = 0;
  const add = (index: number) => {
    const position = cage.positions[index];
    if (!position) return;
    local.add(position);
    count += 1;
  };
  if (kind === "vertex") for (const id of ids) add(Number(id));
  else if (kind === "edge") for (const id of ids) id.split("_").forEach((vertex) => add(Number(vertex)));
  else for (const id of ids) for (const vertex of cage.faces[Number(id)] ?? []) add(vertex);
  if (count > 0) local.multiplyScalar(1 / count);
  return mesh.localToWorld(local);
}
function revealBackfaces(mesh: Mesh): () => void {
  const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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
function hint(axis: Axis | null): string {
  return `Extrude${axis ? ` · ${axis.toUpperCase()}` : ""}  ·  X/Y/Z constrain  ·  Click or Enter confirm  ·  Esc cancel`;
}

/** Edit-mode E: extrude the region, then grab it with the same axis keys as G. */
export class ExtrudeGesture {
  private session: Session | undefined;
  private pointer: Vector2 | null = null;
  private readonly cleanups: (() => void)[] = [];
  constructor(
    viewport: Viewport,
    editor: EditorScene,
    enabled: () => boolean,
    editing: () => boolean,
    target: () => ExtrudeTarget | null,
    onCommit: (commit: ExtrudeCommit) => void,
    onError: (error: unknown) => void,
    status: (text: string) => void,
  ) {
    const dom = viewport.renderer.domElement;
    let pendingMove = false;
    const restore = () => {
      const session = this.session;
      if (!session) return;
      session.mesh.geometry = session.original;
      session.preview?.dispose();
      session.preview = null;
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
      const offset = session.offset;
      const selection = session.selection;
      const commit = confirmed && offset && selection && offset.lengthSq() > 1e-12 ? {
        objectId: session.objectId, meshPath: session.meshPath, kind: session.kind, ids: session.ids,
        offset: [offset.x, offset.y, offset.z] as [number, number, number], selection,
      } : null;
      stop(session);
      if (commit) onCommit(commit);
    };
    const update = () => {
      const session = this.session;
      if (!session || !session.start || !session.current) return;
      const rect = dom.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      try {
        const offset = toLocalOffset(session.mesh, grabWorldDelta(viewport.camera, rect, session.origin, session.start, session.current, session.axis ? AXIS[session.axis] : null));
        if (offset.lengthSq() <= 1e-12) {
          restore();
          session.offset = offset;
          session.selection = null;
        } else {
          const result = extrudeRegion(session.cage, session.kind, session.ids, offset);
          const preview = writeShadedGeometry(session.original, result.mesh);
          session.preview?.dispose();
          session.preview = preview;
          session.mesh.geometry = preview;
          session.offset = offset;
          session.selection = result.selection;
        }
        status(hint(session.axis));
      } catch (error) {
        if (this.session) stop(this.session);
        onError(error);
      }
    };
    const flush = () => {
      if (!pendingMove) return;
      pendingMove = false;
      update();
    };
    const live = (session: Session) => enabled() && editor.currentRevision === session.revision
      && (session.mesh.geometry === session.original || session.mesh.geometry === session.preview);
    const begin = () => {
      const selected = target();
      if (!selected || selected.ids.length === 0 || editor.selection !== selected.objectId) return;
      try {
        const mesh = meshAtPath(editor.getObject(selected.objectId), selected.meshPath);
        if (mesh instanceof SkinnedMesh) throw new Error("Extrude on skinned meshes is not supported yet.");
        if ((modifierStack(mesh)?.modifiers ?? []).some((modifier) => modifier.enabled)) throw new Error("Disable modifiers before extruding, so the selection matches the base mesh");
        const cage = readTopology(mesh.geometry);
        extrudeRegion(cage, selected.kind, selected.ids, new Vector3(0, 1, 0));
        mesh.updateWorldMatrix(true, false);
        this.session = {
          mesh, original: mesh.geometry, cage, kind: selected.kind, ids: [...selected.ids], objectId: selected.objectId,
          meshPath: [...selected.meshPath], origin: componentOrigin(mesh, cage, selected.kind, selected.ids), axis: null,
          start: this.pointer?.clone() ?? null, current: this.pointer?.clone() ?? null, revision: editor.currentRevision,
          cameraEnabled: viewport.controls.enabled, preview: null, offset: null, selection: null,
          restoreMaterial: selected.kind === "face" ? () => undefined : revealBackfaces(mesh),
        };
        active = true;
        viewport.controls.enabled = false;
        status(hint(null));
      } catch (error) { onError(error); }
    };
    const keydown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      const session = this.session;
      if (session) {
        if (!["escape", "enter", "x", "y", "z", "g", "s", "r", "e"].includes(key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === "escape") { pendingMove = false; end(false); }
        else if (key === "enter") { flush(); end(true); }
        else if (key === "x" || key === "y" || key === "z") {
          session.axis = session.axis === key ? null : key;
          pendingMove = false;
          update();
          if (this.session === session) status(hint(session.axis));
        }
        return;
      }
      if (key !== "e" || !enabled() || !editing()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      begin();
    };
    const move = (event: PointerEvent) => {
      this.pointer = new Vector2(event.clientX, event.clientY);
      const session = this.session;
      if (!session) return;
      if (!live(session)) { end(false); return; }
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
      if (event.button === 0) flush();
      else pendingMove = false;
      end(event.button === 0);
    };
    const contextmenu = (event: MouseEvent) => { if (this.session || blockContextMenu) event.preventDefault(); blockContextMenu = false; };
    const blur = () => end(false);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("contextmenu", contextmenu, true);
    window.addEventListener("blur", blur);
    const unsubscribe = editor.onChange(() => { if (this.session && editor.currentRevision !== this.session.revision) end(false); });
    const stopFrame = viewport.addFrameListener(() => { if (this.session && !enabled()) end(false); else flush(); });
    this.cleanups.push(
      () => window.removeEventListener("keydown", keydown, true),
      () => window.removeEventListener("pointermove", move, true),
      () => window.removeEventListener("pointerdown", down, true),
      () => window.removeEventListener("contextmenu", contextmenu, true),
      () => window.removeEventListener("blur", blur),
      unsubscribe,
      stopFrame,
      () => end(false),
    );
  }
  dispose() { for (const cleanup of this.cleanups) cleanup(); }
}
