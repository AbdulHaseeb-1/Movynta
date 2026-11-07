import { useEffect } from "react";
import { Outlet, useMatches } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "./TitleBar";
import { useAppDispatch } from "./hooks";
import {
  backendDisconnected,
  chatgptSessionLoaded,
  chatgptSessionSchema,
  providersLoaded,
  providersSchema,
} from "@/features/providers";
import { backendRequest } from "@/lib/backend";
import { useHelpShortcut } from "@/features/documentation/shortcuts";
import { ShortcutsDialog } from "@/features/documentation/components";

function App() {
  // The page fades in when the route changes, not when only its parameters do.
  const matches = useMatches();
  const routeId = matches[matches.length - 1]?.id ?? "";
  const dispatch = useAppDispatch();
  useHelpShortcut();
  useEffect(() => {
    let stopped = false;
    const connect = () => {
      void backendRequest("/providers", providersSchema)
        .then((providers) => {
          if (stopped) return;
          dispatch(providersLoaded(providers));
          // Keeps the ChatGPT sign-in summary and its 30-day countdown current.
          void backendRequest("/providers/chatgpt/session", chatgptSessionSchema)
            .then((session) => {
              if (!stopped) dispatch(chatgptSessionLoaded(session));
            })
            .catch(() => undefined);
        })
        .catch(() => {
          if (!stopped) dispatch(backendDisconnected());
        });
    };
    connect();
    const retry = window.setInterval(connect, 30000);
    return () => {
      stopped = true;
      clearInterval(retry);
    };
  }, [dispatch]);

  useEffect(() => {
    const splash = document.getElementById("startup-splash");
    const root = document.getElementById("root");
    if (!splash) return undefined;

    const finish = () => {
      splash.remove();
      root?.removeAttribute("inert");
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return undefined;
    }

    let removalTimer: number | undefined;
    const fadeTimer = window.setTimeout(() => {
      splash.classList.add("is-exiting");
      removalTimer = window.setTimeout(finish, 400);
    }, 900);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removalTimer);
    };
  }, []);

  // One provider for the whole app: a tooltip anywhere, such as the attach button on the blank workspace,
  // needs one above it, and without it the page fails to render.
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col overflow-hidden">
        <TitleBar />
        <div
          key={routeId}
          className="min-h-0 flex-1 animate-page-fade-in overflow-y-auto motion-reduce:animate-none"
        >
          <Outlet />
        </div>
        <ShortcutsDialog />
      </div>
    </TooltipProvider>
  );
}

export default App;
