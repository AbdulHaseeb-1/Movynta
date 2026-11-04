import { z } from "zod";
import { CollectionModel, viewCaptureRequestSchema, type ViewCaptureRequest } from "@movynta/editor-protocol";
import type { EditorContext, EditorObject } from "../shared/types/editor-context.types.js";
import { editorCommandListSchema } from "../shared/schemas/editor-command.schema.js";
import type { EditorCommand, EditorCommandList, OutboundMessage } from "./testing.types.js";

export const outboundSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/** Stands in for the base64 text of a picture. The backend only passes it along, so it need not decode. */
export const SIMULATED_IMAGE_BASE64 = Buffer.from("simulated jpeg bytes").toString("base64");

/** Test double for the Tauri/React editor. It speaks the real WebSocket protocol and keeps a scene in memory. */
export class EditorSimulator {
  readonly received: OutboundMessage[] = [];
  readonly executions: { readonly proposalId: string; readonly commands: readonly EditorCommand[] }[] = [];
  /** Every view request the backend sent, with whether it asked for pixels. */
  readonly viewRequests: { readonly request: ViewCaptureRequest; readonly withImages: boolean; readonly captureId: string }[] = [];
  /** When false, the simulator never answers command execution, which exercises timeouts. */
  answerExecutions = true;
  /** Whether the simulated editor advertises the scene-graph commands. Set false to stand in for an older editor. */
  supportsSceneGraph = true;
  /** Whether it advertises collections. Set false to stand in for an editor that predates them. */
  supportsCollections = true;
  private readonly collectionModel = new CollectionModel();
  private readonly waiters: (() => void)[] = [];
  private revision = 0;
  private readonly objects: EditorObject[] = [];

  private constructor(
    private readonly socket: WebSocket,
    readonly clientId: string,
    private readonly projectId: string,
    initialObjects: readonly EditorObject[],
  ) {
    this.objects.push(...initialObjects);
    socket.addEventListener("message", (event) => this.handle(event.data));
  }

  static async connect(
    wsUrl: string,
    token: string,
    projectId: string,
    initialObjects: readonly EditorObject[] = [],
  ): Promise<EditorSimulator> {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
    });

    const authenticated = new Promise<string>((resolve) => {
      const onMessage = (event: MessageEvent<string>): void => {
        const message = outboundSchema.parse(JSON.parse(event.data));
        if (message.event === "auth.ok") {
          socket.removeEventListener("message", onMessage);
          resolve(String(message.data["clientId"]));
        }
      };
      socket.addEventListener("message", onMessage);
    });
    socket.send(JSON.stringify({ event: "auth", data: { token, projectId } }));
    const clientId = await withTimeout(authenticated, 3000, "auth.ok was not received");
    return new EditorSimulator(socket, clientId, projectId, initialObjects);
  }

  get scene(): EditorContext {
    return this.snapshot();
  }

  /** Waits until a message with `event` has been received, or fails after `timeoutMs`. */
  waitForEvent(event: string, timeoutMs = 5000): Promise<OutboundMessage> {
    return withTimeout(this.findOrWait(event), timeoutMs, `event "${event}" was not received`);
  }

  /** Sends a raw protocol message. Used to test how the server handles malformed input. */
  sendRaw(event: string, data: unknown): void {
    this.socket.send(JSON.stringify({ event, data }));
  }

  close(): void {
    this.socket.close();
  }

  private async findOrWait(event: string): Promise<OutboundMessage> {
    for (;;) {
      const found = this.received.find((message) => message.event === event);
      if (found) return found;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private handle(raw: unknown): void {
    if (typeof raw !== "string") return;
    const message: OutboundMessage = outboundSchema.parse(JSON.parse(raw));
    this.received.push(message);

    switch (message.event) {
      case "context.request":
        this.send("context.response", { requestId: message.data["requestId"], context: this.snapshot() });
        break;
      case "commands.execute":
        this.execute(message.data);
        break;
      case "view.request":
        this.captureViews(message.data);
        break;
      default:
        break;
    }

    for (const wake of this.waiters.splice(0)) wake();
  }

  private execute(data: Record<string, unknown>): void {
    const commands: EditorCommandList = editorCommandListSchema.parse(data["commands"]);
    const proposalId = String(data["proposalId"]);
    this.executions.push({ proposalId, commands });
    if (!this.answerExecutions) return;

    for (const command of commands) this.apply(command);
    this.revision += 1;
    this.send("commands.result", {
      requestId: data["requestId"],
      status: "applied",
      revision: this.revision,
      results: commands.map((command) => ({ commandId: command.commandId, status: "applied" })),
    });
  }

  /** Answers a view request with one tiny image per requested view, or with no pixels when images were declined. */
  private captureViews(data: Record<string, unknown>): void {
    const request = viewCaptureRequestSchema.parse(data["request"]);
    const withImages = data["withImages"] === true;
    this.viewRequests.push({ request, withImages, captureId: String(data["captureId"]) });
    const images = request.views.map((view, index) => ({
      label: view.label ?? view.preset ?? `view ${index + 1}`,
      mediaType: "image/jpeg" as const,
      data: withImages ? SIMULATED_IMAGE_BASE64 : "",
      width: request.width ?? 768,
      height: request.height ?? 576,
      camera: {
        projection: "perspective" as const,
        position: [5, 4, 7],
        target: [0, 0, 0],
        fov: 45,
        orthographicHeight: null,
      },
      objects: this.objects.map((object) => ({
        id: object.id,
        name: object.name,
        screenBounds: { x: 10, y: 10, width: 100, height: 100 },
        inFrame: true,
      })),
    }));
    this.send("view.response", {
      requestId: data["requestId"],
      result: {
        images,
        scene: { objectCount: this.objects.length, bounds: null },
        focus: [],
        missingIds: [],
      },
    });
  }

  private apply(command: EditorCommand): void {
    switch (command.type) {
      case "scene.create_object":
      case "geometry.create_mesh":
      case "geometry.create_primitive": {
        const id = command.objectId;
        const name = command.type === "scene.create_object" ? command.name : command.type === "geometry.create_mesh" ? command.name ?? "Mesh" : command.name ?? command.primitive;
        this.objects.push({
          id,
          name,
          type: "mesh",
          parentId: command.parentId ?? null,
          collectionId: command.collectionId ?? (command.parentId === undefined ? null : this.collectionModel.collectionOf(command.parentId)),
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        });
        break;
      }
      case "scene.delete_object": {
        const index = this.objects.findIndex((object) => object.id === command.objectId);
        if (index >= 0) this.objects.splice(index, 1);
        this.collectionModel.forget(command.objectId);
        break;
      }
      case "scene.create_collection":
        this.collectionModel.create(command.collectionId, command.name, command.parentCollectionId ?? null);
        break;
      case "scene.rename_collection":
        this.collectionModel.rename(command.collectionId, command.name);
        break;
      case "scene.set_collection_visibility":
        this.collectionModel.setVisible(command.collectionId, command.visible);
        break;
      case "scene.move_collection":
        this.collectionModel.move(command.collectionId, command.parentCollectionId);
        break;
      case "scene.delete_collection":
        this.collectionModel.remove(command.collectionId);
        break;
      case "scene.move_to_collection": {
        const moving = [command.objectId];
        for (let id = moving.pop(); id !== undefined; id = moving.pop()) {
          this.collectionModel.assign(id, command.collectionId);
          if (command.includeChildren) moving.push(...this.objects.filter((object) => object.parentId === id).map((object) => object.id));
        }
        break;
      }
      case "scene.transform_object":
      case "scene.move_object":
      case "geometry.boolean":
      case "geometry.bevel":
      case "geometry.subdivide":
      case "geometry.set_modifiers":
      case "geometry.transform_faces":
      case "geometry.extrude":
      case "geometry.fill_hole":
      case "geometry.subdivide_faces":
      case "scene.set_visibility":
        break;
      case "scene.rename_object": {
        const object = this.objects.find((item) => item.id === command.objectId);
        if (object) object.name = command.name;
        break;
      }
      case "scene.set_parent": {
        const object = this.objects.find((item) => item.id === command.objectId);
        if (object) object.parentId = command.parentId;
        break;
      }
    }
  }

  private snapshot(): EditorContext {
    return {
      projectId: this.projectId,
      revision: this.revision,
      activeSceneName: "Main",
      selectedObjectIds: [],
      objects: this.objects.map((object) => ({ ...object, collectionId: this.collectionModel.collectionOf(object.id) })),
      collections: this.collectionModel.entries(),
      ...(this.supportsSceneGraph ? { supportsSceneGraph: true } : {}),
      ...(this.supportsCollections ? { supportsCollections: true } : {}),
    };
  }

  private send(event: string, data: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ event, data }));
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
