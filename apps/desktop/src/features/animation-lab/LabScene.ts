import {
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Camera,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraProjection, CameraView } from "./labSettings";
import { themeColor } from "./labTheme";

/** Where the camera sits for each preset, in the character's frame (+Z is forward, +X is the character's left). */
const VIEW_OFFSETS: Readonly<Record<Exclude<CameraView, "free">, Vector3>> = {
  front: new Vector3(0, 0.6, 3.8),
  rear: new Vector3(0, 0.8, -3.8),
  side: new Vector3(3.8, 0.6, 0),
  "three-quarter": new Vector3(2.4, 1.3, 3.0),
};

const TARGET_HEIGHT = 0.95;
const ORTHO_HALF_HEIGHT = 1.7;
const SHADOW_EXTENT = 7;

/** Renderer, lights, both cameras and the orbit controls for the animation lab. */
export class LabScene {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly perspective = new PerspectiveCamera(40, 1, 0.1, 400);
  readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  readonly controls: OrbitControls;
  private camera: Camera = this.perspective;
  private readonly sun = new DirectionalLight(0xffffff, 2.2);
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly followPoint = new Vector3();
  private lastFollow: Vector3 | null = null;
  private following = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = themeColor("background");
    this.scene.add(new HemisphereLight(0xffffff, themeColor("secondary"), 1.35));
    this.sun.position.set(4, 8, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_EXTENT;
    shadowCamera.right = SHADOW_EXTENT;
    shadowCamera.top = SHADOW_EXTENT;
    shadowCamera.bottom = -SHADOW_EXTENT;
    shadowCamera.near = 1;
    shadowCamera.far = 30;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 40;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, TARGET_HEIGHT, 0);
    this.perspective.position.set(...VIEW_OFFSETS["three-quarter"].toArray());
    this.controls.update();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get activeCamera(): Camera {
    return this.camera;
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.orthographic.left = -ORTHO_HALF_HEIGHT * aspect;
    this.orthographic.right = ORTHO_HALF_HEIGHT * aspect;
    this.orthographic.top = ORTHO_HALF_HEIGHT;
    this.orthographic.bottom = -ORTHO_HALF_HEIGHT;
    this.orthographic.updateProjectionMatrix();
  }

  setProjection(projection: CameraProjection): void {
    const next: Camera = projection === "orthographic" ? this.orthographic : this.perspective;
    if (next === this.camera) return;
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    this.camera = next;
    this.controls.object = next;
    this.controls.update();
  }

  /** Moves the camera to a preset relative to the character's position and heading. */
  setView(view: CameraView, characterPosition: Vector3, yaw: number): void {
    if (view === "free") return;
    const offset = VIEW_OFFSETS[view].clone().applyAxisAngle(new Vector3(0, 1, 0), yaw);
    this.controls.target.set(characterPosition.x, characterPosition.y + TARGET_HEIGHT, characterPosition.z);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.position.y = Math.max(this.camera.position.y, 0.3);
    // The preset is relative to the character right now, so following continues from exactly this position.
    this.lastFollow = characterPosition.clone();
    this.controls.update();
  }

  setFollow(follow: boolean): void {
    // Settings are re-applied on every change; only an actual change of mode may restart the follow baseline,
    // otherwise the camera would lose whatever the character moved since the last frame.
    if (follow === this.following) return;
    this.following = follow;
    this.lastFollow = null;
  }

  /** Keeps the camera and its orbit target moving with the character without disturbing the user's orbit. */
  update(characterPosition: Vector3): void {
    if (this.following) {
      this.followPoint.copy(characterPosition);
      if (this.lastFollow) {
        // Height is followed too, so climbing a slope or landing on a platform does not drift the character out of frame.
        const dx = this.followPoint.x - this.lastFollow.x;
        const dy = this.followPoint.y - this.lastFollow.y;
        const dz = this.followPoint.z - this.lastFollow.z;
        this.camera.position.x += dx;
        this.camera.position.y += dy;
        this.camera.position.z += dz;
        this.controls.target.x += dx;
        this.controls.target.y += dy;
        this.controls.target.z += dz;
      }
      this.lastFollow = this.followPoint.clone();
    }
    // The sun and its shadow window travel with the character.
    this.sun.position.set(characterPosition.x + 4, 8, characterPosition.z + 5);
    this.sun.target.position.set(characterPosition.x, 0, characterPosition.z);
    this.controls.update();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.sun.shadow.map?.dispose();
  }
}
