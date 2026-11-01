export interface ModelingToolDependencies {
  /** Tool names a plan step may reference. Unknown names are rejected so plans stay executable. */
  readonly knownToolNames: readonly string[];
}
