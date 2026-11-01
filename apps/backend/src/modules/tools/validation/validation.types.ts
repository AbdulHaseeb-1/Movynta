export interface SceneIssue {
  readonly severity: "error" | "warning";
  readonly objectId: string | null;
  readonly message: string;
}

export interface SceneCheckResult {
  readonly ok: boolean;
  readonly objectCount: number;
  readonly issues: readonly SceneIssue[];
}
