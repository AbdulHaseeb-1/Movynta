import { z } from "zod";
import type { EditorContext, EditorObject } from "../shared/schemas/editor-context.schema.js";
import { editorCommandListSchema } from "../shared/schemas/editor-command.schema.js";

const outboundSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});

type OutboundMessage = z.infer<typeof outboundSchema>;
type EditorCommandList = z.infer<typeof editorCommandListSchema>;
type EditorCommand = EditorCommandList[number];

/** Test double for the Tauri/React editor. It speaks the real WebSocket protocol and keeps a scene in memory. */
export class EditorSimulator {
  readonly received: OutboundMessage[] = [];
  readonly executions: { readonly proposalId: string; readonly commands: readonly EditorCommand[] }[] = [];
  /** When false, the simulator never answers command execution, which exercises timeouts. */
  answerExecutions = true;
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

  private apply(command: EditorCommand): void {
    switch (command.type) {
      case "scene.create_object":
      case "geometry.create_primitive": {
        const id = command.objectId;
        const name = command.type === "scene.create_object" ? command.name : command.primitive;
        this.objects.push({
          id,
          name,
          type: "mesh",
          parentId: null,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        });
        break;
      }
      case "scene.delete_object": {
        const index = this.objects.findIndex((object) => object.id === command.objectId);
        if (index >= 0) this.objects.splice(index, 1);
        break;
      }
      case "scene.transform_object":
        break;
    }
  }

  private snapshot(): EditorContext {
    return {
      projectId: this.projectId,
      revision: this.revision,
      activeSceneName: "Main",
      selectedObjectIds: [],
      objects: [...this.objects],
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
