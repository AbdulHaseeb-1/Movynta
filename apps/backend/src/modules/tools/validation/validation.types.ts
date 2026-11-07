/** One problem the scene check found, with the object it is about if there is one. */
export interface SceneIssue {
  /** An error fails the check, a warning is worth fixing, and information is only worth knowing. */
  readonly severity: "error" | "warning" | "info";
  readonly objectId: string | null;
  readonly message: string;
}

/** The result of a scene check: whether the scene is ok, and the issues found. */
export interface SceneCheckResult {
  readonly ok: boolean;
  readonly objectCount: number;
  readonly issues: readonly SceneIssue[];
}
