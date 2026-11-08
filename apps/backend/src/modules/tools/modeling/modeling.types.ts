/** The known tool names that a plan may refer to. */
export interface ModelingToolDependencies {
  /** Tool names a plan step may reference. Unknown names are rejected so plans stay executable. */
  readonly knownToolNames: readonly string[];
}
