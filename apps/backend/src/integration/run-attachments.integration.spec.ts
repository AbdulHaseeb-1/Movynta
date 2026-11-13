import type { AgentInputItem } from "@openai/agents";
import { assistantMessage, modelResponder } from "@openai/agents/testing";
import { MAX_ATTACHMENTS } from "@movynta/contracts";
import { startTestServer } from "../testing/test-app.js";
import { openEventStream } from "../testing/event-stream.js";
import { EditorSimulator } from "../testing/editor-simulator.js";
import { pictureUpload } from "../testing/pictures.js";
import type { SecretProtector } from "../modules/providers/secret-protector.js";
import type { TestServer } from "../testing/testing.types.js";

/** Keys are not under test here, so the vault stores them as they are. */
const memoryVault: SecretProtector = { protect: (value) => Promise.resolve(value), unprotect: (value) => Promise.resolve(value) };

interface Reply<T> {
  readonly status: number;
  readonly body: T;
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

interface Accepted {
  readonly runId: string;
  readonly sessionId: string;
  readonly eventsUrl: string;
}

interface Conversation {
  readonly messages: readonly { readonly prompt: string; readonly attachments: readonly { readonly name: string; readonly mediaType: string; readonly bytes: number }[] }[];
}

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer(0, { secretProtector: memoryVault });
}, 60_000);

afterAll(async () => {
  await server.close();
});

async function http<T>(method: string, path: string, user: string, body?: unknown): Promise<Reply<T>> {
  const response = await fetch(server.baseUrl + path, {
    method,
    headers: { Authorization: `Bearer ${server.token(user)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text.length > 0 ? JSON.parse(text) : undefined) as T };
}

async function finish(run: Accepted, user: string): Promise<void> {
  const stream = openEventStream(server.baseUrl + run.eventsUrl, server.token(user));
  try {
    await stream.waitFor((event) => event.envelope.type === "run.completed", 20_000);
  } finally {
    stream.stop();
  }
}

/** The parts of the newest user message in a request to the model. */
function lastUserParts(input: string | AgentInputItem[]): readonly { type: string; text?: string; image?: string }[] {
  if (typeof input === "string") return [{ type: "input_text", text: input }];
  for (let at = input.length - 1; at >= 0; at -= 1) {
    const item = input[at];
    if (item && "role" in item && item.role === "user" && Array.isArray(item.content)) return item.content as { type: string; text?: string; image?: string }[];
  }
  return [];
}

describe("images attached to a request", () => {
  it("reach the model with the message, are listed in the saved chat, and stay available to later messages of the chat", async () => {
    const user = "alice-pictures";
    const project = await http<{ id: string }>("POST", "/api/v1/projects", user, {});
    expect(project.status).toBe(201);
    const editor = await EditorSimulator.connect(server.wsUrl, server.token(user), project.body.id);
    const seen: (readonly { type: string; text?: string; image?: string }[])[] = [];
    server.model.enqueue(
      modelResponder((call) => {
        seen.push(lastUserParts(call.request.input));
        return [assistantMessage("I see a round robot head.")];
      }),
      modelResponder((call) => {
        seen.push(lastUserParts(call.request.input));
        // The reference pictures of the first message are still in the chat's history, so the model can compare with them.
        expect(JSON.stringify(call.request.input)).toContain(`data:image/png;base64,${front.data}`);
        expect(JSON.stringify(call.request.input)).toContain(`data:image/jpeg;base64,${side.data}`);
        expect(JSON.stringify(call.request.input)).toContain("Attached image 1 of 2: front.png");
        return [assistantMessage("Understood.")];
      }),
    );
    const front = pictureUpload("image/png", 200, "front.png");
    const side = pictureUpload("image/jpeg", 300, "side.jpg");
    try {
      const first = await http<Accepted>("POST", "/api/v1/agent-runs", user, {
        projectId: project.body.id,
        editorClientId: editor.clientId,
        message: "Model a robot like these",
        attachments: [front, side],
      });
      expect(first.status).toBe(202);
      await finish(first.body, user);

      const parts = seen[0] ?? [];
      expect(parts[0]).toEqual({ type: "input_text", text: "Model a robot like these" });
      expect(parts.filter((part) => part.type === "input_image").map((part) => part.image)).toEqual([
        `data:image/png;base64,${front.data}`,
        `data:image/jpeg;base64,${side.data}`,
      ]);

      const chat = await http<Conversation>("GET", `/api/v1/projects/${project.body.id}/conversation`, user);
      expect(chat.body.messages[0]?.attachments).toEqual([
        { name: "front.png", mediaType: "image/png", bytes: 200 },
        { name: "side.jpg", mediaType: "image/jpeg", bytes: 300 },
      ]);

      const second = await http<Accepted>("POST", "/api/v1/agent-runs", user, {
        projectId: project.body.id,
        editorClientId: editor.clientId,
        sessionId: first.body.sessionId,
        message: "Thanks",
      });
      expect(second.status).toBe(202);
      await finish(second.body, user);
      expect(seen).toHaveLength(2);
    } finally {
      editor.close();
    }
  }, 40_000);

  it("accept a request far larger than other requests may be", async () => {
    const user = "alice-large";
    const editor = await EditorSimulator.connect(server.wsUrl, server.token(user), "proj-large");
    server.model.enqueue([assistantMessage("Got them.")]);
    // A full set of pictures of 2 MB each: over 20 MB of base64, where an ordinary request stops at 256 kB.
    const attachments = Array.from({ length: MAX_ATTACHMENTS }, (_, index) => pictureUpload("image/png", 2 * 1024 * 1024, `big-${index}.png`));
    try {
      const run = await http<Accepted>("POST", "/api/v1/agent-runs", user, {
        projectId: "proj-large",
        editorClientId: editor.clientId,
        message: "Look",
        attachments,
      });
      expect(run.status).toBe(202);
      await finish(run.body, user);
    } finally {
      editor.close();
    }
  }, 40_000);

  it("are cut off at the transport when together they are far past the total limit", async () => {
    // Each picture is within its own limit, but eight of them are well over the 24 MB total.
    const attachments = Array.from({ length: MAX_ATTACHMENTS }, (_, index) => pictureUpload("image/png", 3.5 * 1024 * 1024, `huge-${index}.png`));
    const response = await http<ErrorBody>("POST", "/api/v1/agent-runs", "alice-huge", { projectId: "proj-huge", message: "Look", attachments });
    expect(response.status).toBe(413);
  }, 40_000);

  it("leave every other route with the ordinary size limit", async () => {
    const response = await http<ErrorBody>("POST", "/api/v1/agent-runs/not-a-run/cancel", "alice-limit", { padding: "x".repeat(300 * 1024) });
    expect(response.status).toBe(413);
  });

  it("are refused when they are not pictures of the type they claim, with a message that names the file", async () => {
    const wrongType = { ...pictureUpload("image/jpeg", 64, "photo.png"), mediaType: "image/png" };
    const response = await http<ErrorBody>("POST", "/api/v1/agent-runs", "alice-bad", {
      projectId: "proj-bad",
      message: "Look",
      attachments: [wrongType],
    });
    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('"photo.png" is not a PNG image');
  });

  it("are refused beyond the limit, and for formats the models cannot read", async () => {
    const tooMany = await http<ErrorBody>("POST", "/api/v1/agent-runs", "alice-bad", {
      projectId: "proj-bad",
      message: "Look",
      attachments: Array.from({ length: MAX_ATTACHMENTS + 1 }, () => pictureUpload("image/png")),
    });
    // The request shape is checked before the pictures are: too many is a malformed request.
    expect(tooMany.status).toBe(400);

    const svg = await http<ErrorBody>("POST", "/api/v1/agent-runs", "alice-bad", {
      projectId: "proj-bad",
      message: "Look",
      attachments: [{ name: "logo.svg", mediaType: "image/svg+xml", data: "AAAA" }],
    });
    expect(svg.status).toBe(400);
  });

  it("are refused when the selected connection is set not to receive pictures", async () => {
    const user = "alice-no-pictures";
    const saved = await http<unknown>("POST", "/api/v1/providers/openai-compatible", user, {
      baseUrl: "https://provider.example/proxy/v1",
      model: "text-only",
      apiKey: "test-key",
      acceptsImages: false,
    });
    expect(saved.status).toBe(201);
    expect((await http<unknown>("POST", "/api/v1/providers/active", user, { id: "openai-compatible" })).status).toBeLessThan(300);

    const response = await http<ErrorBody>("POST", "/api/v1/agent-runs", user, {
      projectId: "proj-text-only",
      message: "Look",
      useConfiguredProvider: true,
      attachments: [pictureUpload("image/png")],
    });
    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain("Send pictures");
  });
});
