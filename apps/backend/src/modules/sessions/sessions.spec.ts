import { randomUUID } from "node:crypto";
import type { AgentInputItem } from "@openai/agents";
import { NotFoundError } from "../../common/errors/app-error.js";
import { openInMemoryDatabase } from "../../testing/in-memory-database.js";
import { ProjectAccessService } from "../projects/project-access.service.js";
import { SessionsRepository } from "./sessions.repository.js";
import { SessionsService } from "./sessions.service.js";

function userMessage(text: string): AgentInputItem {
  return { role: "user", content: text } as AgentInputItem;
}

function setup() {
  const database = openInMemoryDatabase();
  const projects = new ProjectAccessService(database);
  const service = new SessionsService(new SessionsRepository(database), projects, database);
  return { database, service };
}

describe("session ownership", () => {
  it("lets the owner read their session", () => {
    const { service } = setup();
    const session = service.create("alice", "proj-1");
    expect(service.getOwned("alice", session.id).projectId).toBe("proj-1");
  });

  it("hides another user's session behind not-found", () => {
    const { service } = setup();
    const session = service.create("alice", "proj-1");
    expect(() => service.getOwned("mallory", session.id)).toThrow(NotFoundError);
  });

  it("refuses to create a session in a project owned by someone else", () => {
    const { service } = setup();
    service.create("alice", "proj-1");
    expect(() => service.create("mallory", "proj-1")).toThrow(/another user/);
  });

  it("treats unknown session ids as not found", () => {
    const { service } = setup();
    expect(() => service.getOwned("alice", randomUUID())).toThrow(NotFoundError);
  });
});

describe("persistent session history", () => {
  it("stores items in order and returns the most recent ones on request", async () => {
    const { service } = setup();
    const session = service.create("alice", "proj-1");
    const store = service.store(session.id);
    await store.addItems([userMessage("one"), userMessage("two"), userMessage("three")]);

    const all = await store.getItems();
    expect(all.map((item) => (item as { content: string }).content)).toEqual(["one", "two", "three"]);
    const last = await store.getItems(2);
    expect(last.map((item) => (item as { content: string }).content)).toEqual(["two", "three"]);
  });

  it("pops and clears history", async () => {
    const { service } = setup();
    const session = service.create("alice", "proj-1");
    const store = service.store(session.id);
    await store.addItems([userMessage("a"), userMessage("b")]);
    expect(await store.popItem()).toEqual(userMessage("b"));
    await store.clearSession();
    expect(await store.getItems()).toEqual([]);
  });

  it("erases history and hides the session when it is deleted", async () => {
    const { service } = setup();
    const session = service.create("alice", "proj-1");
    await service.store(session.id).addItems([userMessage("secret")]);
    service.delete("alice", session.id);
    expect(() => service.getOwned("alice", session.id)).toThrow(NotFoundError);
    expect(await service.store(session.id).getItems()).toEqual([]);
  });
});
