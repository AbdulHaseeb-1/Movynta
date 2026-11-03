import { randomBytes } from "node:crypto";
import type { MeshInspectionRequest, ViewCaptureRequest, ViewCaptureResult } from "@movynta/editor-protocol";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import { ForbiddenError, ServiceUnavailableError } from "../../common/errors/app-error.js";
import type { EditorContext } from "../../shared/types/editor-context.types.js";
import {
  type CommandExecutionRequest,
  type CommandExecutionResult,
  type CommandProposalView,
  type CommandResultMessage,
  type EditorBridge,
  type EditorCommandResult,
  type EditorConnection,
  type EditorConnectionScope,
  type EditorOutboundMessage,
  type PendingRequest,
  type ViewCaptureOptions,
} from "./editor-bridge.types.js";

const SOCKET_OPEN = 1;

/**
 * Request/response bridge to the connected editors. Each request gets a random
 * request id, a timeout, and is answered only by the connection it was sent to.
 */
@Injectable()
export class EditorBridgeService implements EditorBridge {
  private readonly logger = new Logger(EditorBridgeService.name);
  private readonly connections = new Map<string, EditorConnection>();
  private readonly pending = new Map<string, PendingRequest>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  register(connection: EditorConnection): void {
    this.connections.set(connection.clientId, connection);
  }

  /** Forgets the connection and fails every request still waiting on it. */
  unregister(clientId: string): void {
    this.connections.delete(clientId);
    for (const [requestId, request] of this.pending) {
      if (request.clientId !== clientId) continue;
      clearTimeout(request.timer);
      this.pending.delete(requestId);
      request.reject(new ServiceUnavailableError("Editor disconnected"));
    }
  }

  assertConnection(userId: string, projectId: string, clientId: string): EditorConnectionScope {
    const connection = this.connections.get(clientId);
    if (!connection) throw new ServiceUnavailableError("Editor is not connected");
    if (connection.userId !== userId || connection.projectId !== projectId) {
      throw new ForbiddenError("Editor connection belongs to another user or project");
    }
    return { clientId, userId, projectId };
  }

  getContext(clientId: string, inspection?: MeshInspectionRequest): Promise<EditorContext> {
    return new Promise<EditorContext>((resolve, reject) => {
      this.sendRequest(
        clientId,
        (requestId) => ({
          kind: "context",
          clientId,
          timer: this.timeout(requestId, reject),
          resolve,
          reject,
        }),
        (requestId) => ({ event: "context.request", data: { requestId, inspection } }),
      );
    });
  }

  proposeCommands(clientId: string, proposal: CommandProposalView): Promise<void> {
    this.send(this.requireConnection(clientId), { event: "proposal.created", data: { proposal } });
    return Promise.resolve();
  }

  executeCommands(clientId: string, request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    return new Promise<CommandExecutionResult>((resolve, reject) => {
      this.sendRequest(
        clientId,
        (requestId) => ({
          kind: "execute",
          clientId,
          proposalId: request.proposalId,
          timer: this.timeout(requestId, reject),
          resolve,
          reject,
        }),
        (requestId) => ({
          event: "commands.execute",
          data: {
            requestId,
            proposalId: request.proposalId,
            idempotencyKey: request.idempotencyKey,
            expectedRevision: request.expectedRevision,
            commands: request.commands,
            ...(request.phase ? { phase: request.phase } : {}),
          },
        }),
      );
    });
  }

  captureViews(clientId: string, request: ViewCaptureRequest, options: ViewCaptureOptions): Promise<ViewCaptureResult> {
    return new Promise<ViewCaptureResult>((resolve, reject) => {
      this.sendRequest(
        clientId,
        (requestId) => ({
          kind: "capture",
          clientId,
          timer: this.timeout(requestId, reject),
          resolve,
          reject,
        }),
        (requestId) => ({
          event: "view.request",
          data: { requestId, request, withImages: options.withImages, captureId: options.captureId },
        }),
      );
    });
  }

  /** Called by the gateway after schema validation of an inbound view response. */
  resolveCapture(clientId: string, requestId: string, result: ViewCaptureResult): boolean {
    const request = this.takePending(clientId, requestId, "capture");
    if (!request || request.kind !== "capture") return false;
    request.resolve(result);
    return true;
  }

  rejectCapture(clientId: string, requestId: string, message: string): boolean {
    const request = this.takePending(clientId, requestId, "capture");
    if (!request) return false;
    request.reject(new ServiceUnavailableError(`Editor could not draw the view: ${message}`));
    return true;
  }

  /** Called by the gateway after schema validation of an inbound context response. */
  resolveContext(clientId: string, requestId: string, context: EditorContext): boolean {
    const request = this.takePending(clientId, requestId, "context");
    if (!request || request.kind !== "context") return false;
    request.resolve(context);
    return true;
  }

  rejectContext(clientId: string, requestId: string, message: string): boolean {
    const request = this.takePending(clientId, requestId, "context");
    if (!request) return false;
    request.reject(new ServiceUnavailableError(`Editor could not provide context: ${message}`));
    return true;
  }

  resolveCommandResult(clientId: string, requestId: string, message: CommandResultMessage): boolean {
    const request = this.takePending(clientId, requestId, "execute");
    if (!request || request.kind !== "execute") return false;
    const results: EditorCommandResult[] = message.results.map((item) => ({
      commandId: item.commandId,
      status: item.status,
      message: item.message,
    }));
    request.resolve({
      proposalId: request.proposalId,
      status: message.status,
      revision: message.revision,
      results,
      message: message.message,
    });
    return true;
  }

  /** Used by the gateway to send messages that are not request/response pairs. */
  sendRaw(clientId: string, message: EditorOutboundMessage): void {
    this.send(this.requireConnection(clientId), message);
  }

  private sendRequest(
    clientId: string,
    createPending: (requestId: string) => PendingRequest,
    buildMessage: (requestId: string) => EditorOutboundMessage,
  ): void {
    const connection = this.requireConnection(clientId);
    const requestId = randomBytes(12).toString("base64url");
    const pending = createPending(requestId);
    this.pending.set(requestId, pending);
    try {
      this.send(connection, buildMessage(requestId));
    } catch (error) {
      this.takePending(clientId, requestId, pending.kind);
      pending.reject(error instanceof Error ? error : new Error("Failed to send to editor"));
    }
  }

  private timeout(requestId: string, reject: (error: Error) => void): NodeJS.Timeout {
    return setTimeout(() => {
      this.pending.delete(requestId);
      this.logger.warn(`editor request ${requestId} timed out`);
      reject(new ServiceUnavailableError("Editor did not respond in time"));
    }, this.config.editor.requestTimeoutMs);
  }

  /** Removes and returns a pending request only if it belongs to `clientId` and has the expected kind. */
  private takePending(
    clientId: string,
    requestId: string,
    kind: PendingRequest["kind"],
  ): PendingRequest | undefined {
    const request = this.pending.get(requestId);
    if (!request || request.clientId !== clientId || request.kind !== kind) return undefined;
    clearTimeout(request.timer);
    this.pending.delete(requestId);
    return request;
  }

  private requireConnection(clientId: string): EditorConnection {
    const connection = this.connections.get(clientId);
    if (!connection) throw new ServiceUnavailableError("Editor is not connected");
    return connection;
  }

  private send(connection: EditorConnection, message: EditorOutboundMessage): void {
    if (connection.socket.readyState !== SOCKET_OPEN) {
      throw new ServiceUnavailableError("Editor connection is closed");
    }
    connection.socket.send(JSON.stringify(message));
  }
}
