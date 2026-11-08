/** Whether an MCP server is connected, and why not if it is not. */
export interface McpServerStatus {
  readonly name: string;
  readonly state: "disabled" | "configured";
  readonly allowedTools: readonly string[];
}
