import { createHashRouter, Navigate } from "react-router";
import App from "./App";
import { Assistant, Home } from "@/pages";

// Hash routing keeps deep links working when the desktop app loads local files.
/** Shown while a lazily loaded route (the animation lab) is being fetched on first load. */
function RouteFallback() {
  return <div className="h-full bg-background" aria-busy="true" />;
}

export const router = createHashRouter([
  {
    Component: App,
    HydrateFallback: RouteFallback,
    children: [
      { index: true, Component: Home },
      { path: "studio", Component: Assistant },
      // The lab pulls in three.js and the physics engine, so it is only fetched when the route opens.
      { path: "lab", lazy: async () => ({ Component: (await import("@/pages/AnimationLab")).default }) },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
