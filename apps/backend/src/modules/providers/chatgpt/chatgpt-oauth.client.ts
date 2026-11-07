import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ServiceUnavailableError } from "../../../common/errors/app-error.js";
import { ChatgptSignInRequiredError } from "./chatgpt.errors.js";
import {
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_CLIENT_ID,
  CHATGPT_ORIGINATOR,
  CHATGPT_REDIRECT_URI,
  CHATGPT_REQUEST_TIMEOUT_MS,
  CHATGPT_SCOPES,
  CHATGPT_TOKEN_URL,
} from "./chatgpt.constants.js";
import { readTokenClaims } from "./chatgpt-token-claims.js";
import type { ChatgptTokens } from "./chatgpt.types.js";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
});
type TokenResponse = z.infer<typeof tokenResponseSchema>;

const FALLBACK_ACCESS_LIFETIME_MS = 60 * 60 * 1000;

/** Talks to the OpenAI token endpoint. Failures never include the response body, which may echo credentials. */
@Injectable()
export class ChatgptOAuthClient {
  authorizationUrl(state: string, challenge: string): string {
    const url = new URL(CHATGPT_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: CHATGPT_CLIENT_ID,
      redirect_uri: CHATGPT_REDIRECT_URI,
      scope: CHATGPT_SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: CHATGPT_ORIGINATOR,
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, verifier: string): Promise<ChatgptTokens> {
    const response = await this.post(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CHATGPT_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: CHATGPT_REDIRECT_URI,
      }),
    );
    return this.toTokens(response);
  }

  /** Refresh tokens rotate, so the caller must store the result before using it. */
  async refresh(previous: ChatgptTokens): Promise<ChatgptTokens> {
    const response = await this.post({
      client_id: CHATGPT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: previous.refreshToken,
      scope: "openid profile email",
    });
    return this.toTokens(response, previous);
  }

  private toTokens(response: TokenResponse, previous?: ChatgptTokens): ChatgptTokens {
    const idToken = response.id_token ?? previous?.idToken;
    const refreshToken = response.refresh_token ?? previous?.refreshToken;
    if (!idToken || !refreshToken)
      throw new ServiceUnavailableError("ChatGPT sign-in returned an incomplete response. Try again.");
    const accountId =
      readTokenClaims(idToken).accountId ?? readTokenClaims(response.access_token).accountId ?? previous?.accountId;
    if (!accountId)
      throw new ChatgptSignInRequiredError(
        "This sign-in has no ChatGPT account attached. Use an account with a ChatGPT subscription.",
      );
    const accessExpiresAt =
      readTokenClaims(response.access_token).expiresAt ??
      Date.now() + (response.expires_in !== undefined ? response.expires_in * 1000 : FALLBACK_ACCESS_LIFETIME_MS);
    return {
      accessToken: response.access_token,
      refreshToken,
      idToken,
      accountId,
      accessExpiresAt,
    };
  }

  private async post(body: URLSearchParams | Record<string, string>): Promise<TokenResponse> {
    const form = body instanceof URLSearchParams;
    let response: Response;
    try {
      response = await fetch(CHATGPT_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
          Accept: "application/json",
        },
        body: form ? body.toString() : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(CHATGPT_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableError("Could not reach ChatGPT sign-in. Check your network and try again.");
    }
    if (response.status === 400 || response.status === 401)
      throw new ChatgptSignInRequiredError("ChatGPT sign-in is no longer valid. Sign in again.");
    if (!response.ok) throw new ServiceUnavailableError("ChatGPT sign-in is unavailable right now. Try again shortly.");
    // A proxy or captive portal can answer 200 with a page that is not JSON.
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ServiceUnavailableError("ChatGPT sign-in returned an unexpected response.");
    return parsed.data;
  }
}
