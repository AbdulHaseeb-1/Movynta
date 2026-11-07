/** The interactive examples the documentation can show beside a tool. */
export const EXAMPLE_IDS = ["navigation", "transform", "selection"] as const;

/** The id of one interactive example. */
export type ExampleId = (typeof EXAMPLE_IDS)[number];
