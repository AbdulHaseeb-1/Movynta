import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { ForbiddenError, UnauthorizedError } from "../../common/errors/app-error.js";
import { AuthService } from "../auth/auth.service.js";
import { ProjectAccessService } from "../projects/project-access.service.js";
import { EditorBridgeService } from "./editor-bridge.service.js";
import { CommandProposalRepository } from "./proposals/command-proposal.repository.js";
import type { EditorSocket, SocketState } from "./editor-bridge.types.js";
import {
  authMessageSchema,
  commandResultSchema,
  contextErrorSchema,
  contextResponseSchema,
  EDITOR_WS_PATH,
  viewErrorSchema,
  viewResponseSchema,
} from "./editor-protocol.js";

const AUTH_TIMEOUT_MS = 10_000;

/**
 * Editor connections. A client must authenticate with its first message, and
 * after that every message is validated and routed to the bridge.
 */
@WebSocketGateway({ path: EDITOR_WS_PATH })
export class EditorBridgeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EditorBridgeGateway.name);
  private readonly states = new WeakMap<EditorSocket, SocketState>();

  constructor(
    private readonly bridge: EditorBridgeService,
    private readonly auth: AuthService,
    private readonly projects: ProjectAccessService,
    private readonly proposals: CommandProposalRepository,
  ) {}

  handleConnection(client: EditorSocket): void {
    const state: SocketState = { authenticated: false, clientId: undefined, authTimer: undefined };
    state.authTimer = setTimeout(() => {
      if (!state.authenticated) this.fail(client, "auth_timeout", "Authentication timed out", 4408);
    }, AUTH_TIMEOUT_MS);
    this.states.set(client, state);
  }

  handleDisconnect(client: EditorSocket): void {
    const state = this.states.get(client);
    if (!state) return;
    clearTimeout(state.authTimer);
    if (state.clientId) this.bridge.unregister(state.clientId);
  }

  @SubscribeMessage("auth")
  handleAuth(@ConnectedSocket() client: EditorSocket, @MessageBody() body: unknown): void {
    const state = this.requireState(client);
    if (state.authenticated)
      return this.sendError(client, "already_authenticated", "Connection is already authenticated");

    const parsed = authMessageSchema.safeParse(body);
    if (!parsed.success) return this.fail(client, "invalid_message", "Invalid auth message", 4400);

    let userId: string;
    try {
      userId = this.auth.authenticate(parsed.data.token).id;
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      return this.fail(client, "unauthorized", "Invalid or expired token", 4401);
    }

    try {
      this.projects.assertOwner(userId, parsed.data.projectId);
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error;
      return this.fail(client, "forbidden", "Project belongs to another user", 4403);
    }

    const clientId = randomBytes(12).toString("base64url");
    this.bridge.register({ clientId, userId, projectId: parsed.data.projectId, socket: client });
    state.authenticated = true;
    state.clientId = clientId;
    clearTimeout(state.authTimer);
    this.bridge.sendRaw(clientId, {
      event: "auth.ok",
      data: {
        clientId,
        projectId: parsed.data.projectId,
        recoveryRequired: this.proposals.needsRecovery(parsed.data.projectId),
      },
    });
    this.logger.log(`editor connected for project ${parsed.data.projectId}`);
  }

  @SubscribeMessage("context.response")
  handleContextResponse(@ConnectedSocket() client: EditorSocket, @MessageBody() body: unknown): void {
    const clientId = this.requireClientId(client);
    if (!clientId) return;
    const parsed = contextResponseSchema.safeParse(body);
    if (!parsed.success) return this.sendError(client, "invalid_message", "Invalid context response");
    if (!this.bridge.resolveContext(clientId, parsed.data.requestId, parsed.data.context)) {
      this.sendError(client, "unknown_request", "No matching context request");
    }
  }

  @SubscribeMessage("context.error")
  handleContextError(@ConnectedSocket() client: EditorSocket, @MessageBody() body: unknown): void {
    const clientId = this.requireClientId(client);
    if (!clientId) return;
    const parsed = contextErrorSchema.safeParse(body);
    if (!parsed.success) return this.sendError(client, "invalid_message", "Invalid context error");
    if (!this.bridge.rejectContext(clientId, parsed.data.requestId, parsed.data.message)) {
      this.sendError(client, "unknown_request", "No matching context request");
    }
  }

  @SubscribeMessage("commands.result")
  handleCommandResult(@ConnectedSocket() client: EditorSocket, @MessageBody() body: unknown): void {
    const clientId = this.requireClientId(client);
    if (!clientId) return;
    const parsed = commandResultSchema.safeParse(body);
    if (!parsed.success) return this.sendError(client, "invalid_message", "Invalid command result");
    if (!this.bridge.resolveCommandResult(clientId, parsed.data.requestId, parsed.data)) {
      this.sendError(client, "unknown_request", "No matching command request");
    }
  }

  @SubscribeMessage("view.response")
  handleViewResponse(@ConnectedSocket() client: EditorSocket, @MessageBody() body: unknown): void {
    const clientId = this.requireClientId(client);
    if (!clientId) return;
    const parsed = viewResponseSchema.safeParse(body);
    if (!parsed.success) return this.sendError(client, "invalid_message", "Invalid view response");
    if (!this.bridge.resolveCapture(clientId, parsed.data.requestId, parsed.data.result)) {
      this.sendError(client, "unknown_request", "No matching view request");
    }
  }

  @SubscribeMessage("view.error")
  handleViewError(@ConnectedSocket() client: EditorSocket, @MessageBody() body: unknown): void {
    const clientId = this.requireClientId(client);
    if (!clientId) return;
    const parsed = viewErrorSchema.safeParse(body);
    if (!parsed.success) return this.sendError(client, "invalid_message", "Invalid view error");
    if (!this.bridge.rejectCapture(clientId, parsed.data.requestId, parsed.data.message)) {
      this.sendError(client, "unknown_request", "No matching view request");
    }
  }

  private requireState(client: EditorSocket): SocketState {
    const state = this.states.get(client);
    if (!state) throw new Error("Unknown editor socket");
    return state;
  }

  /** Returns the authenticated client id, or sends an error and returns undefined. */
  private requireClientId(client: EditorSocket): string | undefined {
    const state = this.requireState(client);
    if (!state.authenticated || !state.clientId) {
      this.sendError(client, "not_authenticated", "Authenticate before sending other messages");
      return undefined;
    }
    return state.clientId;
  }

  private sendError(client: EditorSocket, code: string, message: string): void {
    if (client.readyState !== 1) return;
    client.send(JSON.stringify({ event: "error", data: { code, message } }));
  }

  private fail(client: EditorSocket, code: string, message: string, closeCode: number): void {
    this.sendError(client, code, message);
    client.close(closeCode, code);
  }
}
