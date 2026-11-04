import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { ensureManifold } from "../../src/features/meshGeometry/meshBoolean";
import { SCENARIOS, recordScenario } from "../../src/features/assistant/golden";

/**
 * Writes the fixtures. Run it on the code that should be the baseline, never on today's code to "refresh" them:
 *
 *   GOLDEN_RECORD=1 GOLDEN_SET=v0-54814fe GOLDEN_COMMIT=54814fe pnpm exec vitest run tests/golden
 *
 * See src/features/assistant/golden/README.md.
 */
const record = process.env["GOLDEN_RECORD"] === "1";
describe.skipIf(!record)("record golden fixtures", () => {
  it("writes one file for each scenario", async () => {
    await ensureManifold();
    const set = process.env["GOLDEN_SET"];
    const commit = process.env["GOLDEN_COMMIT"];
    if (!set || !commit) throw new Error("Set GOLDEN_SET and GOLDEN_COMMIT");
    const folder = join(process.cwd(), "src/features/assistant/golden/fixtures", set);
    mkdirSync(folder, { recursive: true });
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const { steps, summary } = recordScenario(scenario);
      const fixture = { meta: { set, commit, scenario: name, description: scenario.description }, steps, expected: summary };
      writeFileSync(join(folder, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    }
  });
});
