import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router";
import { router, store } from "./app";
import { ensureManifold } from "./features/meshGeometry/meshBoolean";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element in index.html");

void ensureManifold().catch(() => undefined);
ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>,
);
