import type { RunProgress } from "./run-progress.js";

const MAX_REQUEST_CHARS = 4000;

/**
 * The message the independent reviewer starts from: what the user asked, what the builder said "right" meant, and what an
 * earlier review asked to be fixed. It leaves out how the result was built and what the builder said about it, so the
 * reviewer judges the scene and not the account of it.
 */
export function buildReviewRequest(request: string, progress: RunProgress): string {
  const { brief, quality } = progress;
  const lines = ["The user asked:", '"""', request.slice(0, MAX_REQUEST_CHARS), '"""', ""];

  if (brief.current === null) {
    lines.push("The builder recorded no brief, so there are no checks of its own. Judge against the request.");
  } else {
    lines.push(
      `The builder's brief: ${brief.current.subject}${brief.current.style ? ` (${brief.current.style})` : ""}`,
    );
    if (brief.current.assumptions.length > 0)
      lines.push("Assumptions it made:", ...brief.current.assumptions.map((assumption) => `- ${assumption}`));
    const measured = brief.last !== null && !brief.stale;
    lines.push(
      measured
        ? "Its checks, all measured and passing:"
        : "Its checks (not measured on this scene; measure them yourself):",
      ...brief.current.checks.map((check) => `- ${check.label ?? check.kind}`),
    );
    if (brief.revisions > 0)
      lines.push(
        `The brief was rewritten ${brief.revisions} time${brief.revisions === 1 ? "" : "s"} during the work, so check that it still asks for the right things.`,
      );
  }

  if (quality.findings.length > 0) {
    lines.push("", "A previous review asked for these fixes. Check that each one was done:");
    for (const finding of quality.findings)
      lines.push(`- ${finding.aspect}: ${finding.observation}${finding.fix ? ` Fix: ${finding.fix}` : ""}`);
  }
  lines.push("", "Review the scene as it is now.");
  return lines.join("\n");
}
