import type { BriefCheck, BriefCheckResult, EditorContext } from "@movynta/editor-protocol";

/** One editor command as plain data. The editor parses it with the protocol schema when it runs. */
export type ScenarioCommand = Readonly<Record<string, unknown>>;

/** A way a build can go wrong, with the checks it must trip and no others, so each check proves it can fail. */
export interface ScenarioDefect {
  readonly id: string;
  readonly description: string;
  /** Labels of the acceptance checks that this defect makes fail. Every other check must still pass. */
  readonly fails: readonly string[];
}

/**
 * A request to the assistant, the scene it starts from, and the measurable meaning of a good answer. The checks are
 * kept from the assistant: they judge its work independently of the brief it writes for itself.
 */
export interface QualityScenario {
  readonly id: string;
  readonly title: string;
  /** What the user types. */
  readonly prompt: string;
  /** Commands that make the scene the request starts from; empty for a new scene. */
  readonly setup: readonly ScenarioCommand[];
  /**
   * Acceptance checks. In a scene the assistant builds, they name `SUBJECT_ID`, everything it added taken as one group,
   * so they hold whatever it calls its parts. In an edit, they name the objects in `setup` by id.
   */
  readonly checks: readonly BriefCheck[];
  /** The fewest separate mesh parts a real answer has: a chair is not one block. */
  readonly minimumParts?: number;
  /** Objects, by id, that must still be closed solids afterwards. */
  readonly closed?: readonly string[];
  readonly defects: readonly ScenarioDefect[];
  /** A known good answer as commands, or the named defective one. It proves the checks can be met. */
  solution(defectId?: string): readonly ScenarioCommand[];
}

/** What a run left behind: the scene it started from, the scene it ended in, and the openings of the closed solids. */
export interface ScenarioOutcome {
  readonly before: EditorContext;
  readonly after: EditorContext;
  /** Boundary edges of each object named in `closed`; 0 means watertight. */
  readonly openEdges: Readonly<Record<string, number>>;
}

export interface ScenarioScore {
  readonly scenarioId: string;
  readonly passed: number;
  readonly total: number;
  /** passed / total, from 0 to 1. */
  readonly ratio: number;
  readonly results: readonly BriefCheckResult[];
}
