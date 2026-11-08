import { randomUUID } from "node:crypto";
import type { AgentInputItem } from "@openai/agents";
import { openInMemoryDatabase } from "../../testing/in-memory-database.js";
import { SessionsRepository } from "./sessions.repository.js";
import { SqliteSession, withoutImages } from "./sqlite-session.js";

const pictureResult = {
  type: "function_call_result",
  name: "viewport__capture",
  callId: "look-1",
  status: "completed",
  output: [
    { type: "input_text", text: '{"status":"ok","views":[{"image":1}]}' },
    { type: "input_image", image: "data:image/jpeg;base64,AAAA" },
    { type: "input_image", image: "data:image/jpeg;base64,BBBB" },
  ],
} as AgentInputItem;

describe("session history and tool pictures", () => {
  it("keeps the text of a tool result and drops its pictures", () => {
    const stored = withoutImages(pictureResult);
    const serialized = JSON.stringify(stored);

    expect(serialized).not.toContain("AAAA");
    expect(serialized).not.toContain("BBBB");
    expect(serialized).not.toContain("input_image");
    expect(serialized).toContain("views");
    expect(serialized).toContain("capture the view again");
  });

  it("keeps what a user typed and the names of attached images, and drops the images", () => {
    const message = {
      role: "user",
      content: [
        { type: "input_text", text: "Build it like this" },
        { type: "input_text", text: "Attached image 1 of 1: robot.png" },
        { type: "input_image", image: "data:image/png;base64,CCCC" },
      ],
    } as AgentInputItem;
    const serialized = JSON.stringify(withoutImages(message));

    expect(serialized).not.toContain("CCCC");
    expect(serialized).not.toContain("input_image");
    expect(serialized).toContain("Build it like this");
    expect(serialized).toContain("robot.png");
    expect(serialized).toContain("attach it again");
  });

  it("leaves a user message without images as it is", () => {
    const message = { role: "user", content: [{ type: "input_text", text: "hello" }] } as AgentInputItem;
    expect(withoutImages(message)).toBe(message);
  });

  it("leaves other items as they are", () => {
    const message = { role: "user", content: "Look at the torso" } as AgentInputItem;
    const textResult = { type: "function_call_result", name: "editor__get_context", callId: "c", status: "completed", output: "{}" } as AgentInputItem;

    expect(withoutImages(message)).toBe(message);
    expect(withoutImages(textResult)).toBe(textResult);
  });

  it("stores history without the pictures", async () => {
    const database = openInMemoryDatabase();
    const sessionId = randomUUID();
    new SessionsRepository(database).insert({ id: sessionId, userId: "alice", projectId: "proj-1", createdAt: new Date().toISOString() });
    const session = new SqliteSession(database, sessionId);

    await session.addItems([pictureResult]);
    const [item] = await session.getItems();

    expect(JSON.stringify(item)).not.toContain("AAAA");
    expect(JSON.stringify(item)).toContain("views");
  });
});
