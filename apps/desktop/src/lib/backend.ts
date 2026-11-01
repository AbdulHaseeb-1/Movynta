import { z } from "zod";
import { invoke, isTauri } from "@tauri-apps/api/core";

export let BACKEND_URL = "http://127.0.0.1:3001";
let accessToken = "";
let connecting: Promise<void> | undefined;
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
  await ensureBackendConnection();
  const send = () =>
    fetch(`${BACKEND_URL}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(20000),
    });
  let response = await send();
  if (response.status === 401 && isTauri()) {
    accessToken = "";
    await ensureBackendConnection();
    response = await send();
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) accessToken = "";
    const parsed = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(data);
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : "The backend request failed.",
    );
  }
  return schema.parse(data);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
