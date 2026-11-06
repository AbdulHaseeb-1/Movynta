import { afterEach, describe, expect, it, vi } from "vitest";
import { readRunProgress } from "./runClient";

const { backendRequest } = vi.hoisted(() => ({ backendRequest: vi.fn<() => Promise<unknown>>() }));
vi.mock("@/lib/backend", () => ({ BACKEND_URL: "http://127.0.0.1:3001", backendToken: () => "token", backendRequest }));
afterEach(() => { vi.unstubAllGlobals(); backendRequest.mockReset(); });

describe("assistant progress recovery", () => {
  it("checks the live run after the progress stream drops and keeps the last event cursor", async () => {
    backendRequest.mockResolvedValue({ id: "run_1", status: "running" });
    let chunk = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunk++ === 0) controller.enqueue(new TextEncoder().encode('id: 12\ndata: {"type":"tool.started","payload":{}}\n\n'));
        else controller.error(new TypeError("connection lost"));
      },
    });
    let requests = 0;
    let resumedFrom: string | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests += 1;
      if (requests === 1) return new Response(body);
      resumedFrom = new Headers(init.headers).get("Last-Event-ID");
      return new Response('id: 13\ndata: {"type":"tool.completed","payload":{}}\n\n');
    }));
    const cursor = { id: "" };
    const onEvent = vi.fn();
    const run = await readRunProgress("/events", "run_1", new AbortController().signal, onEvent, cursor);
    expect(run.status).toBe("running");
    expect(cursor.id).toBe("12");
    expect(onEvent).toHaveBeenCalledOnce();
    expect(backendRequest).toHaveBeenCalledOnce();
    await readRunProgress("/events", "run_1", new AbortController().signal, onEvent, cursor);
    expect(resumedFrom).toBe("12");
    expect(cursor.id).toBe("13");
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
  it("does not poll the run when the request was cancelled", async () => {
    const abort = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => { abort.abort(); return Promise.reject(abort.signal.reason); }));
    await expect(readRunProgress("/events", "run_1", abort.signal, () => {}, { id: "" })).rejects.toMatchObject({ name: "AbortError" });
    expect(backendRequest).not.toHaveBeenCalled();
  });
  it("does not hide malformed events or authentication failures as a transient disconnect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('data: not-json\n\n')));
    await expect(readRunProgress("/events", "run_1", new AbortController().signal, () => {}, { id: "" })).rejects.toBeInstanceOf(SyntaxError);
    expect(backendRequest).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(readRunProgress("/events", "run_1", new AbortController().signal, () => {}, { id: "" })).rejects.toThrow("Could not open agent progress stream");
    expect(backendRequest).not.toHaveBeenCalled();
  });
});
