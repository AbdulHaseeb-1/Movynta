import { createServer, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ConflictError, ServiceUnavailableError } from "../../../common/errors/app-error.js";
import { CHATGPT_CALLBACK_PATH, CHATGPT_CALLBACK_PORT } from "./chatgpt.constants.js";

export interface CallbackListener {
  /** Resolves with the authorization code; rejects on denial, a bad state, cancellation, or timeout. */
  readonly code: Promise<string>;
  /** Stops listening and rejects `code`. Resolves once the port is free again. Safe to call more than once. */
  close(): Promise<void>;
}

function sameState(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function page(title: string, detail: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Movynta</title><style>html{color-scheme:dark light}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.6 system-ui,sans-serif}main{max-width:360px;padding:32px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{margin:0;opacity:.65}</style></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}

function reply(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Referrer-Policy": "no-referrer",
  });
  response.end(html);
}

/**
 * Listens on the loopback interface for the single OAuth redirect. It answers only the callback
 * path, accepts one matching `state`, and shuts down as soon as it has a result.
 */
export function listenForCallback(expectedState: string, timeoutMs: number): Promise<CallbackListener> {
  return new Promise((resolveListener, rejectListener) => {
    let finish: (outcome: { code: string } | { error: Error }) => void = () => {};
    const code = new Promise<string>((resolve, reject) => {
      finish = (outcome) => {
        if ("code" in outcome) resolve(outcome.code);
        else reject(outcome.error);
      };
    });
    // The service awaits `code`; this keeps a rejection nobody awaits yet from crashing the process.
    code.catch(() => undefined);

    let done = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method !== "GET" || url.pathname !== CHATGPT_CALLBACK_PATH) {
        reply(response, 404, page("Not found", "Return to Movynta."));
        return;
      }
      if (!sameState(url.searchParams.get("state"), expectedState)) {
        reply(response, 400, page("Sign-in rejected", "This link is not from your current sign-in."));
        return;
      }
      const authorization = url.searchParams.get("code");
      if (url.searchParams.has("error") || !authorization) {
        reply(response, 400, page("Sign-in cancelled", "You can close this tab and try again."));
        stop({ error: new ConflictError("The ChatGPT sign-in was cancelled.") });
        return;
      }
      reply(response, 200, page("You are signed in", "You can close this tab and return to Movynta."));
      stop({ code: authorization });
    });

    const closed = new Promise<void>((resolve) => {
      server.once("close", () => resolve());
    });
    const timer = setTimeout(
      () =>
        stop({
          error: new ServiceUnavailableError("The ChatGPT sign-in timed out. Start again."),
        }),
      timeoutMs,
    );
    timer.unref();

    function stop(outcome: { code: string } | { error: Error }): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      finish(outcome);
      // Let the browser finish receiving the page before the socket closes.
      setImmediate(() => {
        server.close();
        server.closeAllConnections();
      });
    }

    server.once("error", (error: NodeJS.ErrnoException) => {
      done = true;
      clearTimeout(timer);
      rejectListener(
        error.code === "EADDRINUSE"
          ? new ConflictError(
              `Port ${CHATGPT_CALLBACK_PORT} is busy. Close any other ChatGPT or Codex sign-in and try again.`,
            )
          : new ServiceUnavailableError("Could not start the sign-in listener."),
      );
    });
    server.listen(CHATGPT_CALLBACK_PORT, "127.0.0.1", () =>
      resolveListener({
        code,
        close: () => {
          stop({ error: new ConflictError("The ChatGPT sign-in was cancelled.") });
          return closed;
        },
      }),
    );
  });
}
