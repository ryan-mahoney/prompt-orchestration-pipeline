import { describe, expect, it } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { Theme } from "@radix-ui/themes";

import { App, routePaths } from "../main";
import { ToastProvider } from "../../components/ui/Toast";

describe("main", () => {
  it("defines all five routes", () => {
    expect(routePaths).toEqual([
      "/",
      "/pipeline/:jobId",
      "/pipelines",
      "/pipelines/:slug",
      "/code",
    ]);
  });

  it("nests providers in the required order", () => {
    const app = App();
    expect(app.type).not.toBeNull();

    const toastLayer = app.props.children;
    expect(toastLayer.type).toBe(ToastProvider);

    const themeLayer = toastLayer.props.children;
    expect(themeLayer.type).toBe(Theme);

    const routerLayer = themeLayer.props.children;
    expect(routerLayer.type).toBe(BrowserRouter);
  });
});
