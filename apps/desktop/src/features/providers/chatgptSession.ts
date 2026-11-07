import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { z } from "zod";
import { backendDisconnected } from "./providersSlice";

const DAY_MS = 24 * 60 * 60 * 1000;

export const chatgptSessionSchema = z.object({
  state: z.enum(["disconnected", "pending", "connected", "expired"]),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  connectedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type ChatgptSession = z.infer<typeof chatgptSessionSchema>;

export const chatgptLoginStartSchema = z.object({
  authorizationUrl: z.url(),
  expiresAt: z.string(),
});

interface ChatgptSessionState {
  session: ChatgptSession | null;
  /** The backend reports a failed sign-in once, so it is kept here until the user dismisses it. */
  error: string | null;
  /** The ChatGPT page of the sign-in in progress, kept for as long as it lasts so the page can be opened again. */
  authorizationUrl: string | null;
}
const initialState: ChatgptSessionState = { session: null, error: null, authorizationUrl: null };

const slice = createSlice({
  name: "chatgptSession",
  initialState,
  reducers: {
    chatgptSessionLoaded(state, action: PayloadAction<ChatgptSession>) {
      state.session = action.payload;
      if (action.payload.error) state.error = action.payload.error;
      if (action.payload.state !== "pending") state.authorizationUrl = null;
    },
    chatgptLoginStarted(state, action: PayloadAction<string>) {
      state.authorizationUrl = action.payload;
    },
    chatgptErrorDismissed(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(backendDisconnected, () => initialState);
  },
});

export const { chatgptSessionLoaded, chatgptLoginStarted, chatgptErrorDismissed } = slice.actions;
export const chatgptSessionReducer = slice.reducer;

/** Whole days left before the sign-in must be renewed; never negative. */
export function daysUntil(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / DAY_MS));
}

/** "Plus" from "plus", "Pro" from "pro"; unknown plans pass through readable. */
export function formatPlan(plan: string): string {
  return plan
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Short summary shown under the provider name, for example "name@mail.com · 29 days left". */
export function describeChatgptSession(session: ChatgptSession | null): string {
  if (session?.state === "pending") return "Waiting for sign-in in your browser";
  if (session?.state === "expired") return "Sign-in expired";
  if (session?.state !== "connected") return "";
  const days = session.expiresAt ? daysUntil(session.expiresAt) : null;
  return [
    session.email,
    days === null ? null : `${days} ${days === 1 ? "day" : "days"} left`,
  ]
    .filter(Boolean)
    .join(" · ");
}
