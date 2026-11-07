import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { EditorScene } from "./EditorScene";
import { connectEditor } from "./editorConnection";

const { ensureBackendConnection } = vi.hoisted(() => ({ ensureBackendConnection: vi.fn<() => Promise<void>>() }));
vi.mock("@/lib/backend", () => ({ BACKEND_URL: "http://127.0.0.1:3001", backendToken: () => "token", ensureBackendConnection }));
vi.mock("@/features/viewCapture", () => ({ rememberCapture() {} }));
vi.mock("../objectEditing/sceneHistory", () => ({ recoverSavedScene: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); ensureBackendConnection.mockReset(); });

// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Connection tests only need these editor fields.
const editor = { projectId: "project", discardPrepared: vi.fn() } as unknown as EditorScene;

describe("editor connection cancellation", () => {
  it("does not start backend setup or create a socket for an already cancelled run", async () => {
    const socket = vi.fn(); vi.stubGlobal("WebSocket", socket);
    const abort = new AbortController(); abort.abort();
    await expect(connectEditor(editor, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(ensureBackendConnection).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });
  it("does not create a socket if cancelled while backend setup is in progress", async () => {
    let finish: (() => void) | undefined;
    ensureBackendConnection.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const socket = vi.fn(); vi.stubGlobal("WebSocket", socket);
    const abort = new AbortController();
    const connecting = connectEditor(editor, abort.signal);
    abort.abort();
    await expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    expect(socket).not.toHaveBeenCalled();
    finish?.();
  });
  it("rejects immediately and closes a socket when cancelled during authentication", async () => {
    ensureBackendConnection.mockResolvedValue();
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      close = vi.fn();
      send = vi.fn();
      constructor() { sockets.push(this); }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("window", { setTimeout });
    const abort = new AbortController();
    const connecting = connectEditor(editor, abort.signal);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    abort.abort();
    await expect(connecting).rejects.toMatchObject({ name: "AbortError" });
    expect(sockets[0]?.close).toHaveBeenCalledOnce();
  });
});

describe("editor connection after sign-in", () => {
  class FakeSocket {
    static readonly OPEN = 1;
    static last: FakeSocket | undefined;
    readyState = 1;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    close = vi.fn();
    send = vi.fn<(data: string) => void>();
    constructor() { FakeSocket.last = this; }
    receive(event: string, data: Record<string, unknown>) {
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- The handler reads only `data`.
      this.onmessage?.({ data: JSON.stringify({ event, data }) } as MessageEvent<unknown>);
    }
    sent(): { event: string; data: Record<string, unknown> }[] {
      return this.send.mock.calls.map(([raw]) => z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }).parse(JSON.parse(raw)));
    }
  }
  const lastSent = (socket: FakeSocket) => { const sent = socket.sent(); return sent[sent.length - 1]; };
  async function connected(scene: EditorScene) {
    ensureBackendConnection.mockResolvedValue();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("window", { setTimeout });
    FakeSocket.last = undefined;
    const connecting = connectEditor(scene, new AbortController().signal);
    // Read through a function: the assignment above would otherwise narrow it to undefined for good.
    const latest = (): FakeSocket | undefined => FakeSocket.last;
    await vi.waitFor(() => expect(latest()).toBeDefined());
    const socket = latest();
    if (!socket) throw new Error("no socket");
    socket.receive("auth.ok", { clientId: "client" });
    await connecting;
    return socket;
  }

  it("keeps the connection when the backend reports a late answer", async () => {
    const socket = await connected(editor);
    socket.receive("error", { code: "unknown_request", message: "No matching context request" });
    socket.receive("not json", {});
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("closes the connection when the backend refuses its sign-in", async () => {
    const socket = await connected(editor);
    socket.receive("error", { code: "unauthorized", message: "Invalid or expired token" });
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("answers a context request it cannot read with a reason instead of dropping the editor", async () => {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Only the fields the connection reads.
    const failing = { projectId: "project", discardPrepared: vi.fn(), context: () => { throw new Error("Mesh is not loaded"); } } as unknown as EditorScene;
    const socket = await connected(failing);
    socket.receive("context.request", { requestId: "req_1" });
    expect(lastSent(socket)).toEqual({ event: "context.error", data: { requestId: "req_1", message: "Mesh is not loaded" } });
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("answers an unreadable command batch as failed", async () => {
    const socket = await connected(editor);
    socket.receive("commands.execute", { requestId: "req_2" });
    expect(lastSent(socket)).toMatchObject({ event: "commands.result", data: { requestId: "req_2", status: "failed" } });
    expect(socket.close).not.toHaveBeenCalled();
  });
});
