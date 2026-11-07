import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  chatgptErrorDismissed,
  chatgptLoginStarted,
  chatgptLoginStartSchema,
  chatgptSessionLoaded,
  chatgptSessionSchema,
  providersLoaded,
  providersSchema,
  type ChatgptSession,
} from "@/features/providers";
import { backendRequest, errorMessage } from "@/lib/backend";

const POLL_INTERVAL_MS = 1500;

export interface ChatgptSignIn {
  session: ChatgptSession | null;
  busy: boolean;
  message: string;
  /** Starts a sign-in and opens the ChatGPT page in the browser. */
  signIn: () => Promise<void>;
  /** Opens the page of the sign-in in progress again, for example after closing the tab. */
  reopen: () => Promise<void>;
  cancel: () => Promise<void>;
  signOut: () => Promise<void>;
}

async function openInBrowser(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Drives the ChatGPT subscription sign-in. The backend runs the OAuth flow; this hook opens the
 * browser, follows the backend's progress, and refreshes the provider list once sign-in completes.
 */
export function useChatgptSignIn(): ChatgptSignIn {
  const dispatch = useAppDispatch();
  const session = useAppSelector((state) => state.chatgptSession.session);
  const sessionError = useAppSelector((state) => state.chatgptSession.error);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  // Kept in the store, not here, so the page can still be opened after Settings was closed and opened again.
  const authorizationUrl = useAppSelector((state) => state.chatgptSession.authorizationUrl);
  const polling = useRef(false);

  const loadSession = useCallback(async () => {
    const next = await backendRequest("/providers/chatgpt/session", chatgptSessionSchema);
    dispatch(chatgptSessionLoaded(next));
    return next;
  }, [dispatch]);

  const reloadProviders = useCallback(async () => {
    dispatch(providersLoaded(await backendRequest("/providers", providersSchema)));
  }, [dispatch]);

  const pending = session?.state === "pending";
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      loadSession()
        .then(async (next) => {
          if (next.state === "connected") await reloadProviders();
        })
        .catch((error: unknown) => setActionError(errorMessage(error)))
        .finally(() => {
          polling.current = false;
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pending, loadSession, reloadProviders]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setActionError("");
      dispatch(chatgptErrorDismissed());
      try {
        await action();
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [dispatch],
  );

  return {
    session,
    busy,
    message: actionError || sessionError || "",
    signIn: () =>
      run(async () => {
        const started = await backendRequest("/providers/chatgpt/login", chatgptLoginStartSchema, "POST");
        dispatch(chatgptLoginStarted(started.authorizationUrl));
        await loadSession();
        await openInBrowser(started.authorizationUrl);
      }),
    reopen: () =>
      run(async () => {
        if (!authorizationUrl)
          throw new Error("The sign-in page is no longer available here. Cancel the sign-in, then sign in again.");
        await openInBrowser(authorizationUrl);
      }),
    cancel: () =>
      run(async () => {
        dispatch(
          chatgptSessionLoaded(await backendRequest("/providers/chatgpt/login", chatgptSessionSchema, "DELETE")),
        );
      }),
    signOut: () =>
      run(async () => {
        dispatch(providersLoaded(await backendRequest("/providers/chatgpt", providersSchema, "DELETE")));
        await loadSession();
      }),
  };
}
