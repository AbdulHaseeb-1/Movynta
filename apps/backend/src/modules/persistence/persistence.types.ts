import type { SQLOutputValue } from "node:sqlite";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export type SqlRow = Readonly<Record<string, SQLOutputValue>>;
