import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Provider } from "react-redux";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AttachButton } from "@/features/attachments";
import App from "./App";
import { store } from "./store";

async function renderAt(path: string): Promise<string> {
  const routes = [{ Component: App, children: [{ index: true, element: createElement(AttachButton, { onFiles: () => undefined }) }] }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost${path}`));
  if (context instanceof Response) throw new Error("Unexpected redirect");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(
    <Provider store={store}>
      <StaticRouterProvider router={router} context={context} />
    </Provider>,
  );
}

describe("the app shell", () => {
  it("lets any page show a tooltip, such as the attach button on the blank workspace", async () => {
    expect(await renderAt("/")).toContain("Attach images");
  });
});
