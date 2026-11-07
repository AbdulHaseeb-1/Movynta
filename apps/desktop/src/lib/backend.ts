import { z } from "zod";
import { invoke, isTauri } from "@tauri-apps/api/core";

export let BACKEND_URL = "http://127.0.0.1:3001";
let accessToken = "";
let connecting: Promise<void> | undefined;
export class BackendResponseError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = "BackendResponseError"; this.status = status; }
}
export async function ensureBackendConnection(): Promise<void> {
  if (accessToken) return;
  if (!isTauri())
    throw new Error(
      "Open the desktop app to connect automatically to the local backend.",
    );
  connecting ??= invoke<string>("backend_access")
    .then((token) => {
      accessToken = token.trim();
    })
    .finally(() => {
      connecting = undefined;
    });
  await connecting;
}
// Tests use a separate loopback port so they never interrupt the user's running backend.
export function setBackendToken(token: string, port?: number) {
  if (port !== undefined) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid loopback port");
    BACKEND_URL = `http://127.0.0.1:${port}`;
  }
  accessToken = token.trim();
}
export function backendToken() {
  return accessToken;
}

export async function backendRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await authorizedFetch(
    path,
    {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(20000),
    },
    body === undefined ? {} : { "Content-Type": "application/json" },
  );
  // A 204 has no body, e.g. after deleting something.
  const data = response.status === 204 ? undefined : await readJson(response);
  if (!response.ok) throw new BackendResponseError(failureMessage(data), response.status);
  return schema.parse(data);
}

/**
 * The JSON body of a response, or undefined when it has none or it is not JSON, such as an empty
 * reply or an HTML error page. A failed request then still reports its status instead of a parse error.
 */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) return undefined;
    throw new BackendResponseError("The backend sent a reply that could not be read.", response.status);
  }
}

/** Sends a request with the backend token, getting a fresh token once if the old one was refused. */
async function authorizedFetch(
  path: string,
  init: Omit<RequestInit, "headers">,
  headers: Record<string, string>,
): Promise<Response> {
  await ensureBackendConnection();
  const send = async () => {
    try {
      return await fetch(`${BACKEND_URL}/api/v1${path}`, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${accessToken}` },
      });
    } catch (failure) {
      throw networkFailure(failure);
    }
  };
  let response = await send();
  if (response.status === 401 && isTauri()) {
    accessToken = "";
    await ensureBackendConnection();
    response = await send();
  }
  if (response.status === 401) accessToken = "";
  return response;
}

/**
 * A readable error for a request that never got an answer. A cancelled request keeps its own error,
 * so callers can still tell a cancel from a failure.
 */
function networkFailure(failure: unknown): Error {
  if (failure instanceof DOMException && failure.name === "AbortError") return failure;
  if (failure instanceof DOMException && failure.name === "TimeoutError")
    return new Error("The Movynta backend took too long to answer. Try again.");
  if (failure instanceof TypeError)
    return new Error("Could not reach the Movynta backend. Check that it is running, then try again.");
  return failure instanceof Error ? failure : new Error("The backend request failed.");
}

function failureMessage(data: unknown): string {
  const parsed = z
    .object({ error: z.object({ message: z.string() }) })
    .safeParse(data);
  return parsed.success
    ? parsed.data.error.message
    : "The backend request failed.";
}

/** Sends a file as the request body, for example a model being imported. */
export async function backendUpload<T>(
  path: string,
  schema: z.ZodType<T>,
  data: Blob,
  signal?: AbortSignal,
): Promise<T> {
  const response = await authorizedFetch(
    path,
    {
      method: "POST",
      body: data,
      signal: signal ?? AbortSignal.timeout(120000),
    },
    { "Content-Type": "application/octet-stream" },
  );
  const body = await readJson(response);
  if (!response.ok) throw new BackendResponseError(failureMessage(body), response.status);
  return schema.parse(body);
}

/** Fetches a file the backend keeps, such as an imported model. */
export async function backendDownload(
  path: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await authorizedFetch(
    path,
    { method: "GET", signal: signal ?? AbortSignal.timeout(120000) },
    {},
  );
  if (!response.ok) throw new BackendResponseError(failureMessage(await readJson(response)), response.status);
  return response.arrayBuffer();
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
