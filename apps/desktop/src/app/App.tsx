import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { TitleBar } from "./TitleBar";
import { useAppDispatch } from "./hooks";
import {
  backendDisconnected,
  providersLoaded,
  providersSchema,
} from "@/features/providers";
import { backendRequest } from "@/lib/backend";

function App() {
  const { pathname } = useLocation();
  const dispatch = useAppDispatch();
  useEffect(() => {
    let stopped = false;
    const connect = () => {
      void backendRequest("/providers", providersSchema)
        .then((providers) => {
          if (!stopped) dispatch(providersLoaded(providers));
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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div
        key={pathname}
        className="min-h-0 flex-1 animate-page-fade-in overflow-y-auto motion-reduce:animate-none"
      >
        <Outlet />
      </div>
    </div>
  );
}

export default App;
