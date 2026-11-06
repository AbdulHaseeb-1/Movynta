import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { emptyRunProgress } from "../../agent-runs/run-progress.js";
import { createQualityTools } from "./quality.tools.js";

function fixture(images = true) {
  let revision = 5;
  const bridge = {
    assertConnection: () => ({}),
    getContext: async () => ({ revision }),
  } as unknown as EditorBridge;
  const progress = emptyRunProgress();
  progress.quality.required = true;
  progress.quality.changes = 1;
  const context = { userId: "u", projectId: "p", clientId: "c", progress, supportsToolImages: images } as unknown as AgentRunContext;
  const tool = createQualityTools(bridge)[0];
  if (!tool) throw new Error("Missing quality tool");
  return { context, progress, tool, setRevision: (next: number) => { revision = next; } };
}

const ready = { outcome: "ready", summary: "The requested shape is present.", findings: [{ aspect: "silhouette", observation: "The overall outline matches the request.", severity: "minor" }, { aspect: "proportions", observation: "The main parts are proportionate.", severity: "minor" }] };
const needsWork = { outcome: "needs_refinement", summary: "Hands are missing.", findings: [{ aspect: "hands", observation: "Hands are missing", severity: "major" }] };

describe("quality assessments", () => {
  it("requires fresh visual evidence for ready and refinement outcomes", async () => {
    const f = fixture();
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected" });
    f.progress.quality.captureRevision = 5;
    f.progress.quality.viewpoints = ["front", "side"];
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "recorded", outcome: "ready" });
    f.setRevision(6);
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected" });
    expect(f.progress.quality.viewpoints).toEqual([]);
  });
  it("cannot declare ready with major findings or without acting on a previous review", async () => {
    const f = fixture();
    f.progress.quality.captureRevision = 5;
    f.progress.quality.viewpoints = ["front", "side"];
    expect(await f.tool.execute({ ...needsWork, outcome: "ready" }, f.context)).toMatchObject({ status: "rejected" });
    expect(await f.tool.execute(needsWork, f.context)).toMatchObject({ status: "recorded" });
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected" });
    expect(await f.tool.execute({ outcome: "blocked", summary: "The required feature cannot be built.", findings: [{ aspect: "feature", observation: "The operation is unsupported.", severity: "major" }] }, f.context)).toMatchObject({ status: "recorded", outcome: "blocked" });
  });
  it("allows an honest blocked assessment when images are unavailable", async () => {
    const f = fixture(false);
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected" });
    expect(await f.tool.execute({ outcome: "blocked", summary: "Cannot see images.", findings: [{ aspect: "evidence", observation: "Images are unavailable.", severity: "major" }] }, f.context)).toMatchObject({ status: "recorded" });
  });
});
