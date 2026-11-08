import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../persistence/database.service.js";
import { optionalTextColumn, textColumn } from "../../persistence/row.js";
import type { StoredChatgptLogin } from "./chatgpt.types.js";

/** One ChatGPT sign-in per user. Tokens are stored only as ciphertext. */
@Injectable()
export class ChatgptLoginRepository {
  constructor(private readonly database: DatabaseService) {}

  find(userId: string): StoredChatgptLogin | undefined {
    const row = this.database.db
      .prepare("SELECT encrypted_tokens, email, plan, connected_at, expires_at FROM chatgpt_logins WHERE user_id = ?")
      .get(userId);
    if (!row) return undefined;
    return {
      encryptedTokens: textColumn(row, "encrypted_tokens"),
      email: optionalTextColumn(row, "email"),
      plan: optionalTextColumn(row, "plan"),
      connectedAt: textColumn(row, "connected_at"),
      expiresAt: textColumn(row, "expires_at"),
    };
  }

  upsert(userId: string, login: StoredChatgptLogin): void {
    this.database.db
      .prepare(
        `INSERT INTO chatgpt_logins (user_id, encrypted_tokens, email, plan, connected_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET encrypted_tokens = excluded.encrypted_tokens, email = excluded.email,
           plan = excluded.plan, connected_at = excluded.connected_at, expires_at = excluded.expires_at`,
      )
      .run(userId, login.encryptedTokens, login.email ?? null, login.plan ?? null, login.connectedAt, login.expiresAt);
  }

  /** Stores rotated tokens without changing the sign-in's 30-day window. */
  replaceTokens(userId: string, encryptedTokens: string): void {
    this.database.db
      .prepare("UPDATE chatgpt_logins SET encrypted_tokens = ? WHERE user_id = ?")
      .run(encryptedTokens, userId);
  }

  delete(userId: string): void {
    this.database.db.prepare("DELETE FROM chatgpt_logins WHERE user_id = ?").run(userId);
  }
}
