import { ConflictError } from "../../common/errors/app-error.js";
import { isTerminal, transitionRun } from "./agent-run.state-machine.js";

describe("agent run state machine", () => {
  it("follows the approval path: running, waiting, running, completed", () => {
    let status = transitionRun("created", "running");
    status = transitionRun(status, "waiting_approval");
    status = transitionRun(status, "running");
    status = transitionRun(status, "completed");
    expect(status).toBe("completed");
  });

  it("lets a run that never started fail during recovery", () => {
    expect(transitionRun("created", "failed")).toBe("failed");
  });

  it("rejects moves out of terminal states", () => {
    expect(() => transitionRun("completed", "running")).toThrow(ConflictError);
    expect(() => transitionRun("cancelled", "running")).toThrow(ConflictError);
  });

  it("rejects skipping straight from created to completed", () => {
    expect(() => transitionRun("created", "completed")).toThrow(ConflictError);
  });

  it("marks completed, failed, and cancelled as terminal", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("waiting_approval")).toBe(false);
  });
});
