/** The access and refresh tokens of a ChatGPT sign-in. */
export interface ChatgptTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  /** Epoch milliseconds at which the access token stops working. */
  accessExpiresAt: number;
}

/** Who signed in with ChatGPT. */
export interface ChatgptIdentity {
  email: string | undefined;
  plan: string | undefined;
}

/** Where the ChatGPT sign-in stands: disconnected, pending, connected or expired. */
export type ChatgptSessionState = "disconnected" | "pending" | "connected" | "expired";

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

/** What a sign-in needs to show the user: the page address to open. */
export interface ChatgptLoginStart {
  authorizationUrl: string;
  /** When the pending sign-in stops waiting for the browser. */
  expiresAt: string;
}

/** The credentials used to make a ChatGPT request. */
export interface ChatgptAccessCredentials {
  accessToken: string;
  accountId: string;
}

/** A ChatGPT sign-in as it is stored, with its tokens encrypted. */
export interface StoredChatgptLogin {
  encryptedTokens: string;
  email: string | undefined;
  plan: string | undefined;
  connectedAt: string;
  expiresAt: string;
}
