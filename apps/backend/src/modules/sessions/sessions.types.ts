/** A chat session as it is stored. */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly deletedAt: string | undefined;
}
