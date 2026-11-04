export interface SceneIssue {
  /** An error fails the check, a warning is worth fixing, and information is only worth knowing. */
  readonly severity: "error" | "warning" | "info";
  readonly objectId: string | null;
  readonly message: string;
}

export interface SceneCheckResult {
  readonly ok: boolean;
  readonly objectCount: number;
  readonly issues: readonly SceneIssue[];
}
