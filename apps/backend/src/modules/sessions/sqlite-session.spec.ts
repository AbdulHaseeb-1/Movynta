import { randomUUID } from "node:crypto";
import type { AgentInputItem } from "@openai/agents";
import { openInMemoryDatabase } from "../../testing/in-memory-database.js";
import { SessionsRepository } from "./sessions.repository.js";
import { KEPT_REFERENCE_CHARS, KEPT_REFERENCE_PICTURES, SqliteSession, withoutToolPictures } from "./sqlite-session.js";

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

/** A message the user sent with one attached picture. Its data is `IMG<label>`, so a test can find that picture. */
function referenceMessage(label: string, data = `IMG${label}`): AgentInputItem {
  return {
    role: "user",
    content: [
      { type: "input_text", text: `Reference ${label}` },
      { type: "input_image", image: `data:image/png;base64,${data}` },
    ],
  } as AgentInputItem;
}

function newSession(): { database: ReturnType<typeof openInMemoryDatabase>; session: SqliteSession; sessionId: string } {
  const database = openInMemoryDatabase();
  const sessionId = randomUUID();
  new SessionsRepository(database).insert({ id: sessionId, userId: "alice", projectId: "proj-1", createdAt: new Date().toISOString() });
  return { database, session: new SqliteSession(database, sessionId), sessionId };
}

async function historyText(session: SqliteSession): Promise<string> {
  return JSON.stringify(await session.getItems());
}

describe("session history and pictures", () => {
  it("keeps the text of a tool result and drops its pictures", () => {
    const stored = withoutToolPictures(pictureResult);
    const serialized = JSON.stringify(stored);

    expect(serialized).not.toContain("AAAA");
    expect(serialized).not.toContain("BBBB");
    expect(serialized).not.toContain("input_image");
    expect(serialized).toContain("views");
    expect(serialized).toContain("capture the view again");
  });

  it("keeps a picture the user attached, because the assistant cannot draw it again", () => {
    const message = {
      role: "user",
      content: [
        { type: "input_text", text: "Build it like this" },
        { type: "input_text", text: "Attached image 1 of 1: robot.png" },
        { type: "input_image", image: "data:image/png;base64,CCCC" },
      ],
    } as AgentInputItem;

    expect(withoutToolPictures(message)).toBe(message);
  });

  it("leaves other items as they are", () => {
    const message = { role: "user", content: "Look at the torso" } as AgentInputItem;
    const textResult = { type: "function_call_result", name: "editor__get_context", callId: "c", status: "completed", output: "{}" } as AgentInputItem;

    expect(withoutToolPictures(message)).toBe(message);
    expect(withoutToolPictures(textResult)).toBe(textResult);
  });

  it("stores a tool's pictures out of the history", async () => {
    const { session } = newSession();

    await session.addItems([pictureResult]);
    const [item] = await session.getItems();

    expect(JSON.stringify(item)).not.toContain("AAAA");
    expect(JSON.stringify(item)).toContain("views");
  });

  it("keeps a reference picture for the messages that follow it", async () => {
    const { session } = newSession();

    await session.addItems([referenceMessage("01")]);
    await session.addItems([{ role: "user", content: "Make the arms thicker" } as AgentInputItem]);

    const history = await historyText(session);
    expect(history).toContain("base64,IMG01");
    expect(history).toContain("Make the arms thicker");
    expect(history).not.toContain("no longer kept");
  });

  it("keeps the newest reference pictures, and releases the data of the older ones", async () => {
    const { database, session, sessionId } = newSession();
    const labels = Array.from({ length: KEPT_REFERENCE_PICTURES + 2 }, (_, index) => String(index + 1).padStart(2, "0"));

    for (const label of labels) await session.addItems([referenceMessage(label)]);

    const history = await historyText(session);
    const released = labels.slice(0, 2);
    const kept = labels.slice(2);
    for (const label of released) expect(history).not.toContain(`base64,IMG${label}`);
    for (const label of kept) expect(history).toContain(`base64,IMG${label}`);
    expect(history).toContain("no longer kept");

    // The released data is gone from storage too, not only from what is read back.
    const stored = database.db
      .prepare("SELECT item_json FROM session_items WHERE session_id = ?")
      .all(sessionId)
      .map((row) => String(row["item_json"]))
      .join("\n");
    for (const label of released) expect(stored).not.toContain(`base64,IMG${label}`);
    expect(stored).toContain(`base64,IMG${labels[labels.length - 1]}`);
  });

  it("keeps no more picture data than the window allows", async () => {
    const { session } = newSession();
    // Two pictures that do not fit together: the newer one fits alone, so only it stays.
    const half = Math.floor(KEPT_REFERENCE_CHARS / 2) + 1;

    await session.addItems([referenceMessage("01", "P".repeat(half))]);
    await session.addItems([referenceMessage("02", "Q".repeat(half))]);

    const history = await historyText(session);
    expect(history).toContain(`base64,${"Q".repeat(half)}`);
    expect(history).not.toContain("base64,P");
    expect(history).toContain("no longer kept");
  });
});
