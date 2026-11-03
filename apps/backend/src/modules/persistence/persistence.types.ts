import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
  /**
   * Work that plain statements cannot say, such as adding a column only if it is missing. It runs after the
   * statements, in the same transaction.
   */
  readonly run?: (db: DatabaseSync) => void;
}

export type SqlRow = Readonly<Record<string, SQLOutputValue>>;
