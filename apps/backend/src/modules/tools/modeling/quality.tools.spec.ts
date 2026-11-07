import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import { briefSchema } from "@movynta/editor-protocol";
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
  // A realistic request needs a brief, measured and passing, before the work can be called ready.
  progress.brief.current = briefSchema.parse({ subject: "Figure", checks: [{ kind: "count", selector: { name: "Body" } }] });
  progress.brief.last = { revision: 5, measurable: true, total: 1, passed: 1, failing: [] };
  const context = { userId: "u", projectId: "p", clientId: "c", progress, supportsToolImages: images } as unknown as AgentRunContext;
  const tool = createQualityTools(bridge)[0];
  if (!tool) throw new Error("Missing quality tool");
  return { context, progress, tool, setRevision: (next: number) => { revision = next; } };
}

const ready = { outcome: "ready", summary: "The requested shape is present.", findings: [{ aspect: "silhouette", observation: "The overall outline matches the request.", severity: "minor" }, { aspect: "proportions", observation: "The main parts are proportionate.", severity: "minor" }] };
const needsWork = { outcome: "needs_refinement", summary: "Hands are missing.", findings: [{ aspect: "hands", observation: "Hands are missing", severity: "major" }] };

/** Pictures the reviewer took of the current scene, from two camera positions. */
function looked(f: ReturnType<typeof fixture>, views = 2): void {
  f.progress.quality.captureRevision = 5;
  f.progress.quality.viewpoints = ["front", "side"].slice(0, views);
}

describe("quality assessments", () => {
  it("requires pictures of two views at the current scene for ready, and forgets pictures of an older scene", async () => {
    const f = fixture();
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected" });
    looked(f, 1);
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("at least two distinct") });
    looked(f);
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "recorded", outcome: "ready", evidence: "visual" });
    f.setRevision(6);
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("scene changed") });
    expect(f.progress.quality).toMatchObject({ viewpoints: [], captureRevision: null, outcome: null, findings: [] });
  });

  it("makes a reviewer who can see look before it finds fault, but lets one who cannot see rely on measurements", async () => {
    const seeing = fixture();
    expect(await seeing.tool.execute(needsWork, seeing.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("Look at the scene") });
    looked(seeing, 1);
    expect(await seeing.tool.execute(needsWork, seeing.context)).toMatchObject({ status: "recorded", outcome: "needs_refinement", evidence: "visual" });
    const blind = fixture(false);
    expect(await blind.tool.execute(needsWork, blind.context)).toMatchObject({ status: "recorded", outcome: "needs_refinement", evidence: "measurements" });
    // Seeing nothing, it still cannot approve.
    const approving = fixture(false);
    looked(approving);
    expect(await approving.tool.execute(ready, approving.context)).toMatchObject({ status: "rejected" });
  });

  it("treats a viewport that cannot draw like a model that cannot see: findings from measurements, never approval", async () => {
    const f = fixture();
    f.progress.quality.viewportUnavailable = true;
    expect(await f.tool.execute(needsWork, f.context)).toMatchObject({ status: "recorded", outcome: "needs_refinement", evidence: "measurements" });
    const approving = fixture();
    approving.progress.quality.viewportUnavailable = true;
    looked(approving);
    expect(await approving.tool.execute(ready, approving.context)).toMatchObject({ status: "rejected" });
  });

  it("keeps the findings, with their fixes, for the builder", async () => {
    const f = fixture(false);
    await f.tool.execute({ outcome: "needs_refinement", summary: "Legs are missing.", findings: [
      { aspect: "legs", observation: "There are no legs.", severity: "major", fix: "Add four legs." },
      { aspect: "color", observation: "Flat.", severity: "minor" },
    ] }, f.context);
    expect(f.progress.quality.outcome).toBe("needs_refinement");
    expect(f.progress.quality.findings).toEqual([
      { aspect: "legs", observation: "There are no legs.", severity: "major", fix: "Add four legs." },
      { aspect: "color", observation: "Flat.", severity: "minor" },
    ]);
  });

  it("cannot declare ready while the brief is missing, unmeasured or failing, but can still report a blocker", async () => {
    const f = fixture();
    looked(f);
    f.progress.brief.last = { revision: 5, measurable: true, total: 3, passed: 2, failing: ["size y of named \"Body\": 2, needs at most 1"] };
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("1 brief check still fail") });
    f.progress.brief.last = { revision: 5, measurable: true, total: 3, passed: 3, failing: [] };
    f.progress.brief.stale = true;
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("validation.check_brief") });
    f.progress.brief.stale = false;
    f.progress.brief.current = null;
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("modeling.record_brief") });
    expect(await f.tool.execute({ outcome: "blocked", summary: "Cannot build it.", findings: [{ aspect: "feature", observation: "Unsupported.", severity: "major" }] }, f.context)).toMatchObject({ status: "recorded" });
  });

  it("cannot approve with a major finding or on a single aspect, and cannot ask for work when only polish is left", async () => {
    const f = fixture();
    looked(f);
    expect(await f.tool.execute({ ...needsWork, outcome: "ready" }, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("major unresolved") });
    expect(await f.tool.execute({ ...ready, findings: ready.findings.slice(0, 1) }, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("two distinct aspects") });
    const polish = { outcome: "needs_refinement", summary: "Nearly there.", findings: [{ aspect: "color", observation: "A little flat.", severity: "minor" }] };
    expect(await f.tool.execute(polish, f.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("only minor polish") });
    expect(await f.tool.execute({ ...needsWork, findings: [] }, f.context)).toMatchObject({ status: "rejected" });
  });

  it("allows an honest blocked verdict when images are unavailable, and needs applied changes to review at all", async () => {
    const f = fixture(false);
    expect(await f.tool.execute(ready, f.context)).toMatchObject({ status: "rejected" });
    expect(await f.tool.execute({ outcome: "blocked", summary: "Cannot see images.", findings: [{ aspect: "evidence", observation: "Images are unavailable.", severity: "major" }] }, f.context)).toMatchObject({ status: "recorded", evidence: "not required" });
    const nothing = fixture();
    nothing.progress.quality.changes = 0;
    expect(await nothing.tool.execute(ready, nothing.context)).toMatchObject({ status: "rejected", reason: expect.stringContaining("Apply scene changes") });
  });
});
