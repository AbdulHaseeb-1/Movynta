export interface McpServerStatus {
  readonly name: string;
  readonly state: "disabled" | "configured";
  readonly allowedTools: readonly string[];
}
