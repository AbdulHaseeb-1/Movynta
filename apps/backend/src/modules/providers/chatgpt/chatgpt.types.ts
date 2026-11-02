export interface ChatgptTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  /** Epoch milliseconds at which the access token stops working. */
  accessExpiresAt: number;
}

export interface ChatgptIdentity {
  email: string | undefined;
  plan: string | undefined;
}

export type ChatgptSessionState =
  | "disconnected"
  | "pending"
  | "connected"
  | "expired";

/** What clients see. Tokens never leave the backend. */
export interface ChatgptSessionView {
  state: ChatgptSessionState;
  email: string | null;
  plan: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  /** Why the last attempt failed, reported once. */
  error: string | null;
}

export interface ChatgptLoginStart {
  authorizationUrl: string;
  /** When the pending sign-in stops waiting for the browser. */
  expiresAt: string;
}

export interface ChatgptAccessCredentials {
  accessToken: string;
  accountId: string;
}

export interface StoredChatgptLogin {
  encryptedTokens: string;
  email: string | undefined;
  plan: string | undefined;
  connectedAt: string;
  expiresAt: string;
}
