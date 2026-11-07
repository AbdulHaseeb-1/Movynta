import type { BriefCheck, BriefCheckResult, EditorContext } from "@movynta/editor-protocol";

/** One editor command as plain data. The editor parses it with the protocol schema when it runs. */
export type ScenarioCommand = Readonly<Record<string, unknown>>;

/**
 * A statement about the mesh of one object, which bounds cannot make: whether it is closed, how much it encloses, how many
 * holes it has and where, how many faces. Measured on the base cage, in the object's own coordinates for volume and in
 * world coordinates for where a hole is, so scenarios keep their objects unscaled and unturned.
 */
export type MeshCheck =
  | { readonly kind: "closed"; readonly objectId: string; readonly label?: string }
  | { readonly kind: "volume"; readonly objectId: string; readonly label: string; readonly min: number; readonly max: number }
  | { readonly kind: "openings"; readonly objectId: string; readonly label: string; readonly count: number }
  /** Some hole has its center within the range on an axis (world coordinates). */
  | { readonly kind: "opening-at"; readonly objectId: string; readonly label: string; readonly axis: "x" | "y" | "z"; readonly min: number; readonly max: number }
  | { readonly kind: "faces"; readonly objectId: string; readonly label: string; readonly min?: number; readonly max?: number }
  /** Some vertex lies within `tolerance` (default 0.02) of the point, in world coordinates. */
  | { readonly kind: "has-vertex"; readonly objectId: string; readonly label: string; readonly point: readonly [number, number, number]; readonly tolerance?: number };

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
  /** What must hold of the meshes afterwards. */
  readonly meshChecks?: readonly MeshCheck[];
  readonly defects: readonly ScenarioDefect[];
  /** A known good answer as commands, or the named defective one. It proves the checks can be met. */
  solution(defectId?: string): readonly ScenarioCommand[];
}

/** The measurements of one mesh that mesh checks read. */
export interface MeshMeasure {
  readonly faces: number;
  /** Edges with a face on one side only, plus edges shared by more than two faces. 0 means watertight. */
  readonly openEdges: number;
  /** Closed chains of boundary edges. */
  readonly openings: number;
  /** World-space center of each opening. */
  readonly openingCenters: readonly (readonly [number, number, number])[];
  /** Signed volume enclosed by the base cage: negative when the faces point inward. */
  readonly volume: number;
  /** World-space position of each vertex of the base cage, up to the first 2,048. */
  readonly vertices: readonly (readonly [number, number, number])[];
}

/** What a run left behind: the scene it started from, the scene it ended in, and the meshes the checks read. */
export interface ScenarioOutcome {
  readonly before: EditorContext;
  readonly after: EditorContext;
  /** Measurements of each object named by a mesh check. */
  readonly meshes: Readonly<Record<string, MeshMeasure>>;
}

export interface ScenarioScore {
  readonly scenarioId: string;
  readonly passed: number;
  readonly total: number;
  /** passed / total, from 0 to 1. */
  readonly ratio: number;
  readonly results: readonly BriefCheckResult[];
}
