import { createHashRouter, Navigate } from "react-router";
import App from "./App";
import { Assistant, Home } from "@/pages";

// Hash routing keeps deep links working when the desktop app loads local files.
export const router = createHashRouter([
  {
    Component: App,
    children: [
      { index: true, Component: Home },
      { path: "studio", Component: Assistant },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
