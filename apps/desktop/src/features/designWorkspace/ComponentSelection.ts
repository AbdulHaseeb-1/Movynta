import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Raycaster,
  type Object3D,
} from "three";
import type { Viewport } from "@/features/viewport3d";
import { watchClicks } from "@/features/viewport3d/clicks";
import { toNdc } from "@/features/objectEditing/picking";
import { isEditableTarget } from "@/features/meshGeometry/meshInspection";
import {
  componentGeometry,
  faceHighlightPositions,
  pickComponent,
  type ComponentGeometry,
} from "./componentGeometry";
import type { ComponentKind } from "./workspaceSlice";

interface Target {
  source: Mesh;
  path: number[];
  data: ComponentGeometry;
  proxy: Mesh;
  overlay: Group;
}
interface Selection {
  path: number[];
  ids: string[];
}
function isDrawable(node: Object3D): node is Mesh | LineSegments | Points {
  return (
    node instanceof Mesh ||
    node instanceof LineSegments ||
    node instanceof Points
  );
}
/** Owns temporary picking and highlight geometry; never changes the source mesh. */
export class ComponentSelection {
  private targets: Target[] = [];
  private selected: Selection | null = null;
  private stop: () => void;
  private stopFrame: () => void;
  private stopKeys: () => void;
  private kind: ComponentKind;
  private onSelect: (value: Selection | null) => void;
  constructor(
    viewport: Viewport,
    root: Object3D,
    kind: ComponentKind,
    onSelect: (value: Selection | null) => void,
  ) {
    this.kind = kind;
    this.onSelect = onSelect;
    // Match the object-selection outline; the neutral mesh wire is black.
    const tint = new Color(0xff9b21);
    const visit = (node: Object3D, path: number[]) => {
      if (isEditableTarget(node)) {
        if ("isSkinnedMesh" in node)
          throw new Error(
            "Component selection on skinned meshes is not supported yet.",
          );
        const data = componentGeometry(node.geometry);
        const proxy = new Mesh(
          data.picking,
          new MeshBasicMaterial({ side: DoubleSide }),
        );
        proxy.matrixAutoUpdate = false;
        const overlay = new Group();
        overlay.matrixAutoUpdate = false;
        const lines: number[] = [];
        for (const pair of data.edges.values())
          for (const id of pair) {
            const p = data.mesh.positions[id];
            if (p) lines.push(p.x, p.y, p.z);
          }
        const wire = new LineSegments(
          new BufferGeometry().setAttribute(
            "position",
            new Float32BufferAttribute(lines, 3),
          ),
          new LineBasicMaterial({
            color: 0x000000,
            depthTest: true,
          }),
        );
        overlay.add(wire);
        this.targets.push({ source: node, path, data, proxy, overlay });
        if (kind === "vertex")
          overlay.add(
            new Points(
              new BufferGeometry().setFromPoints(data.mesh.positions),
              new PointsMaterial({
                color: 0x000000,
                size: 4,
                sizeAttenuation: false,
              }),
            ),
          );
        overlay.traverse((child) => {
          child.raycast = () => undefined;
        });
        viewport.scene.add(overlay);
      }
      node.children.forEach((child, i) => visit(child, [...path, i]));
    };
    try {
      visit(root, []);
    } catch (error) {
      this.disposeTargets();
      throw error;
    }
    const ray = new Raycaster();
    const dom = viewport.renderer.domElement;
    this.stop = watchClicks(dom, {
      capture: true,
      onClick: (event) => {
        event.preventDefault();
        this.sync();
        const bounds = dom.getBoundingClientRect();
        const cursor = toNdc(event.clientX, event.clientY, bounds);
        ray.setFromCamera(cursor, viewport.camera);
        const hit = ray.intersectObjects(
          this.targets.map((entry) => entry.proxy),
          false,
        )[0];
        const target = hit
          ? this.targets.find((entry) => entry.proxy === hit.object)
          : undefined;
        const id =
          target && hit?.faceIndex !== undefined && hit.faceIndex !== null
            ? pickComponent(
                target.data,
                hit.faceIndex,
                kind,
                cursor,
                target.source.matrixWorld,
                viewport.camera,
                bounds.width,
                bounds.height,
              )
            : undefined;
        if (!target || id === undefined) {
          if (!event.shiftKey) this.selected = null;
        } else {
          const previous =
            event.shiftKey &&
            this.selected?.path.join("/") === target.path.join("/")
              ? this.selected.ids
              : [];
          this.selected = {
            path: target.path,
            ids: previous.includes(id)
              ? previous.filter((value) => value !== id)
              : [...previous, id],
          };
        }
        this.highlight(tint);
        this.onSelect(this.selected);
      },
    });
    this.stopFrame = viewport.addFrameListener(() => this.sync());
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target;
      if (
        element instanceof HTMLElement &&
        (element.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
      )
        return;
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        this.selected = null;
        this.highlight(tint);
        this.onSelect(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    this.stopKeys = () =>
      window.removeEventListener("keydown", onKeyDown, true);
    this.sync();
  }
  private sync() {
    for (const target of this.targets) {
      target.source.updateWorldMatrix(true, false);
      target.proxy.matrixWorld.copy(target.source.matrixWorld);
      target.overlay.matrix.copy(target.source.matrixWorld);
      target.overlay.visible = target.source.visible;
    }
  }
  private highlight(tint: Color) {
    for (const target of this.targets) {
      while (
        target.overlay.children.length > (this.kind === "vertex" ? 2 : 1)
      ) {
        const child =
          target.overlay.children[target.overlay.children.length - 1];
        if (child) {
          this.disposeObject(child);
          target.overlay.remove(child);
        }
      }
      if (target.path.join("/") !== this.selected?.path.join("/")) continue;
      const positions: number[] =
        this.kind === "face"
          ? faceHighlightPositions(target.data, this.selected.ids)
          : [];
      const add = (id: number) => {
        const p = target.data.mesh.positions[id];
        if (p) positions.push(p.x, p.y, p.z);
      };
      for (const id of this.selected.ids) {
        if (this.kind === "vertex") add(Number(id));
        else if (this.kind === "edge") {
          const edge = target.data.edges.get(id);
          if (edge) edge.forEach(add);
        }
      }
      const geometry = new BufferGeometry().setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3),
      );
      const selected =
        this.kind === "vertex"
          ? new Points(
              geometry,
              new PointsMaterial({
                color: tint,
                size: 7,
                sizeAttenuation: false,
                depthTest: false,
              }),
            )
          : this.kind === "edge"
            ? new LineSegments(
                geometry,
                new LineBasicMaterial({ color: tint, depthTest: false }),
              )
            : new Mesh(
                geometry,
                new MeshBasicMaterial({
                  color: tint,
                  transparent: true,
                  opacity: 0.35,
                  side: DoubleSide,
                  depthWrite: false,
                  polygonOffset: true,
                  polygonOffsetFactor: -2,
                }),
              );
      selected.renderOrder = 1000;
      selected.raycast = () => undefined;
      target.overlay.add(selected);
      if (this.kind === "face") {
        const outline: number[] = [];
        for (const id of this.selected.ids) {
          const face = target.data.mesh.faces[Number(id)];
          if (!face) continue;
          face.forEach((vertex, index) => {
            const next = face[(index + 1) % face.length];
            const a = target.data.mesh.positions[vertex];
            const b =
              next === undefined ? undefined : target.data.mesh.positions[next];
            if (a && b) outline.push(a.x, a.y, a.z, b.x, b.y, b.z);
          });
        }
        const border = new LineSegments(
          new BufferGeometry().setAttribute(
            "position",
            new Float32BufferAttribute(outline, 3),
          ),
          new LineBasicMaterial({ color: tint, depthTest: false }),
        );
        border.renderOrder = 1001;
        border.raycast = () => undefined;
        target.overlay.add(border);
      }
    }
  }
  private disposeObject(object: Object3D) {
    object.traverse((node) => {
      if (isDrawable(node)) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
  private disposeTargets() {
    for (const target of this.targets) {
      target.overlay.removeFromParent();
      this.disposeObject(target.overlay);
      this.disposeObject(target.proxy);
    }
    this.targets = [];
  }
  dispose() {
    this.stop();
    this.stopFrame();
    this.stopKeys();
    this.disposeTargets();
  }
}
