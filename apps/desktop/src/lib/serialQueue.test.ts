import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serialQueue";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("the serial queue", () => {
  it("runs tasks one at a time, in the order they were queued, however long each takes", async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    queue.run(async () => {
      log.push("slow starts");
      await wait(20);
      log.push("slow ends");
    }, () => undefined);
    queue.run(async () => {
      log.push("quick");
    }, () => undefined);
    await wait(60);
    expect(log).toEqual(["slow starts", "slow ends", "quick"]);
  });

  it("reports a failure to the task's own handler and carries on with the next task", async () => {
    const queue = createSerialQueue();
    const failures: unknown[] = [];
    const log: string[] = [];
    queue.run(() => Promise.reject(new Error("could not save")), (failure) => failures.push(failure));
    queue.run(async () => {
      log.push("next");
    }, (failure) => failures.push(failure));
    await wait(20);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(Error);
    expect(log).toEqual(["next"]);
  });
});
