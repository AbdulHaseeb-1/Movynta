import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../../../common/errors/app-error.js";
import { ChatgptSignInRequiredError } from "./chatgpt.errors.js";
import { SECRET_PROTECTOR, type SecretProtector } from "../secret-protector.js";
import { listenForCallback, type CallbackListener } from "./chatgpt-callback-server.js";
import { ChatgptLoginRepository } from "./chatgpt-login.repository.js";
import { ChatgptOAuthClient } from "./chatgpt-oauth.client.js";
import { generatePkce, generateState } from "./chatgpt-pkce.js";
import { readTokenClaims } from "./chatgpt-token-claims.js";
import {
  CHATGPT_LOGIN_TIMEOUT_MS,
  CHATGPT_LOGIN_TTL_MS,
  CHATGPT_REFRESH_MARGIN_MS,
} from "./chatgpt.constants.js";
import type {
  ChatgptAccessCredentials,
  ChatgptLoginStart,
  ChatgptSessionView,
  ChatgptTokens,
  StoredChatgptLogin,
} from "./chatgpt.types.js";

const tokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  accountId: z.string().min(1),
  accessExpiresAt: z.number(),
});

interface PendingLogin {
  readonly verifier: string;
  readonly listener: CallbackListener;
  readonly expiresAt: Date;
  cancelled: boolean;
}

const EXPIRED_MESSAGE =
  "Your ChatGPT sign-in expired. Sign in again in Settings > Providers.";

/**
 * Owns the ChatGPT subscription sign-in: the browser flow, encrypted token storage, refresh, and the
 * 30-day limit on how long one sign-in stays usable. Tokens are returned only to backend callers.
 */
@Injectable()
export class ChatgptAuthService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatgptAuthService.name);
  private readonly pending = new Map<string, PendingLogin>();
  private readonly failures = new Map<string, string>();
  private readonly refreshing = new Map<string, Promise<ChatgptTokens>>();
  private connectedListener: ((userId: string) => Promise<void>) | undefined;

  constructor(
    private readonly logins: ChatgptLoginRepository,
    @Inject(SECRET_PROTECTOR) private readonly vault: SecretProtector,
    private readonly oauth: ChatgptOAuthClient,
  ) {}

  /** Lets the provider registry adopt the account as soon as a sign-in completes. */
  onConnected(listener: (userId: string) => Promise<void>): void {
    this.connectedListener = listener;
  }

  onModuleDestroy(): void {
    for (const login of this.pending.values()) {
      login.cancelled = true;
      void login.listener.close();
    }
    this.pending.clear();
  }

  session(userId: string): ChatgptSessionView {
    const stored = this.stored(userId);
    const error = this.failures.get(userId) ?? null;
    this.failures.delete(userId);
    const base = {
      email: stored?.email ?? null,
      plan: stored?.plan ?? null,
      connectedAt: stored?.connectedAt ?? null,
      expiresAt: stored?.expiresAt ?? null,
      error,
    };
    if (this.pending.has(userId)) return { ...base, state: "pending" };
    if (!stored) return { ...base, state: "disconnected" };
    return { ...base, state: stored.encryptedTokens ? "connected" : "expired" };
  }

  isConnected(userId: string): boolean {
    return Boolean(this.stored(userId)?.encryptedTokens);
  }

  async beginLogin(userId: string): Promise<ChatgptLoginStart> {
    await this.cancelLogin(userId);
    const { verifier, challenge } = generatePkce();
    const state = generateState();
    const listener = await listenForCallback(state, CHATGPT_LOGIN_TIMEOUT_MS);
    const login: PendingLogin = {
      verifier,
      listener,
      expiresAt: new Date(Date.now() + CHATGPT_LOGIN_TIMEOUT_MS),
      cancelled: false,
    };
    this.pending.set(userId, login);
    this.failures.delete(userId);
    void this.finishLogin(userId, login);
    return {
      authorizationUrl: this.oauth.authorizationUrl(state, challenge),
      expiresAt: login.expiresAt.toISOString(),
    };
  }

  async cancelLogin(userId: string): Promise<void> {
    const login = this.pending.get(userId);
    if (!login) return;
    login.cancelled = true;
    this.pending.delete(userId);
    await login.listener.close();
  }

  async disconnect(userId: string): Promise<void> {
    await this.cancelLogin(userId);
    this.logins.delete(userId);
    this.failures.delete(userId);
  }

  /** A usable access token, refreshed first when it is close to expiring. */
  async credentials(userId: string): Promise<ChatgptAccessCredentials> {
    const stored = this.stored(userId);
    if (!stored) throw new ChatgptSignInRequiredError("Sign in with ChatGPT in Settings first.");
    if (!stored.encryptedTokens) throw new ChatgptSignInRequiredError(EXPIRED_MESSAGE);
    let tokens = await this.decrypt(userId, stored.encryptedTokens);
    if (tokens.accessExpiresAt - Date.now() < CHATGPT_REFRESH_MARGIN_MS)
      tokens = await this.refresh(userId);
    return { accessToken: tokens.accessToken, accountId: tokens.accountId };
  }

  /** The stored login, with its tokens wiped once the 30-day window has passed. */
  private stored(userId: string): StoredChatgptLogin | undefined {
    const login = this.logins.find(userId);
    if (!login) return undefined;
    if (login.encryptedTokens && Date.parse(login.expiresAt) <= Date.now()) {
      this.logins.replaceTokens(userId, "");
      this.logger.log(`ChatGPT sign-in for ${userId} reached its 30-day limit`);
      return { ...login, encryptedTokens: "" };
    }
    return login;
  }

  private async finishLogin(userId: string, login: PendingLogin): Promise<void> {
    try {
      const code = await login.listener.code;
      const tokens = await this.oauth.exchangeCode(code, login.verifier);
      if (login.cancelled) return;
      await this.save(userId, tokens);
      await this.connectedListener?.(userId);
    } catch (error) {
      if (login.cancelled) return;
      this.failures.set(
        userId,
        error instanceof AppError ? error.message : "The ChatGPT sign-in failed.",
      );
      if (!(error instanceof AppError))
        this.logger.warn("ChatGPT sign-in failed unexpectedly");
    } finally {
      if (this.pending.get(userId) === login) this.pending.delete(userId);
    }
  }

  private async save(userId: string, tokens: ChatgptTokens): Promise<void> {
    const identity = readTokenClaims(tokens.idToken);
    const now = Date.now();
    this.logins.upsert(userId, {
      encryptedTokens: await this.encrypt(userId, tokens),
      email: identity.email,
      plan: identity.plan,
      connectedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CHATGPT_LOGIN_TTL_MS).toISOString(),
    });
  }

  /** Concurrent callers share one refresh, because refresh tokens rotate and a second use would fail. */
  private refresh(userId: string): Promise<ChatgptTokens> {
    const running = this.refreshing.get(userId);
    if (running) return running;
    const task = (async () => {
      try {
        // The tokens this caller read may be older than the stored ones: another caller can have refreshed
        // since, and a rotated refresh token is rejected when used again, which would sign the user out.
        const latest = await this.currentTokens(userId);
        if (latest.accessExpiresAt - Date.now() >= CHATGPT_REFRESH_MARGIN_MS) return latest;
        const next = await this.oauth.refresh(latest);
        this.logins.replaceTokens(userId, await this.encrypt(userId, next));
        return next;
      } catch (error) {
        // A rejected refresh token cannot recover; require a new sign-in.
        if (error instanceof ChatgptSignInRequiredError) this.logins.replaceTokens(userId, "");
        throw error;
      }
    })().finally(() => this.refreshing.delete(userId));
    this.refreshing.set(userId, task);
    return task;
  }

  /** The tokens as they are stored now. */
  private async currentTokens(userId: string): Promise<ChatgptTokens> {
    const encrypted = this.stored(userId)?.encryptedTokens;
    if (!encrypted) throw new ChatgptSignInRequiredError(EXPIRED_MESSAGE);
    return this.decrypt(userId, encrypted);
  }

  private encrypt(userId: string, tokens: ChatgptTokens): Promise<string> {
    return this.vault.protect(JSON.stringify(tokens), `${userId}:chatgpt`);
  }

  private async decrypt(userId: string, ciphertext: string): Promise<ChatgptTokens> {
    const plain = await this.vault.unprotect(ciphertext, `${userId}:chatgpt`);
    return tokensSchema.parse(JSON.parse(plain));
  }
}
