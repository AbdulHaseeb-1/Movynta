import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { TitleBar } from "./TitleBar";

function App() {
  const { pathname } = useLocation();

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
    <>
      <TitleBar />
      <div key={pathname} className="min-h-screen animate-page-fade-in motion-reduce:animate-none">
        <Outlet />
      </div>
    </>
  );
}

export default App;
