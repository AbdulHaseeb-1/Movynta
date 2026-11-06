import { afterEach, describe, expect, it, vi } from "vitest";
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
