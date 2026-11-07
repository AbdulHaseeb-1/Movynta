/** The interactive examples the documentation can show beside a tool. */
export const EXAMPLE_IDS = ["navigation", "transform", "selection"] as const;

export type ExampleId = (typeof EXAMPLE_IDS)[number];
