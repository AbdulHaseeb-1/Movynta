import { briefSchema } from "@movynta/editor-protocol";
import { buildReviewRequest } from "./review-request.js";
import { emptyRunProgress } from "./run-progress.js";

const brief = briefSchema.parse({
  subject: "A wooden chair",
  style: "simple",
  assumptions: ["One unit is one meter"],
  checks: [{ kind: "size", label: "Chair height", target: { name: "Chair" }, axis: "y", min: 0.8, max: 1 }, { kind: "connected", group: { name: "Chair" } }],
});

describe("the reviewer's request", () => {
  it("states what the user asked, and nothing about how the result was built", () => {
    const progress = emptyRunProgress();
    const text = buildReviewRequest("Make a chair", progress);
    expect(text).toContain('"""\nMake a chair\n"""');
    expect(text).toContain("recorded no brief");
    expect(text).toContain("Review the scene as it is now.");
    expect(text).not.toContain("plan");
  });

  it("lists the builder's brief, its assumptions and its checks by label, saying whether they were measured", () => {
    const progress = emptyRunProgress();
    progress.brief.current = brief;
    progress.brief.last = { revision: 3, measurable: true, total: 2, passed: 2, failing: [] };
    const measured = buildReviewRequest("Make a chair", progress);
    expect(measured).toContain("The builder's brief: A wooden chair (simple)");
    expect(measured).toContain("- One unit is one meter");
    expect(measured).toContain("all measured and passing:\n- Chair height\n- connected");
    progress.brief.stale = true;
    expect(buildReviewRequest("Make a chair", progress)).toContain("not measured on this scene; measure them yourself");
    progress.brief.revisions = 2;
    expect(buildReviewRequest("Make a chair", progress)).toContain("rewritten 2 times");
  });

  it("tells a later reviewer what the earlier one asked for", () => {
    const progress = emptyRunProgress();
    progress.quality.findings = [{ aspect: "legs", observation: "There are none.", severity: "major", fix: "Add four." }, { aspect: "back", observation: "Floats.", severity: "major" }];
    const text = buildReviewRequest("Make a chair", progress);
    expect(text).toContain("A previous review asked for these fixes. Check that each one was done:");
    expect(text).toContain("- legs: There are none. Fix: Add four.");
    expect(text).toContain("- back: Floats.");
  });

  it("keeps a very long request within the limit", () => {
    expect(buildReviewRequest("x".repeat(10_000), emptyRunProgress()).length).toBeLessThan(4400);
  });
});
