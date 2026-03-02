import "./test-dom";

import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, expect, test } from "bun:test";

import PageSubheader from "../PageSubheader";
import { StageTimeline } from "../StageTimeline";

afterEach(() => {
  document.body.innerHTML = "";
});

test("StageTimeline sorts by order and puts unordered stages last", () => {
  const view = render(
    <StageTimeline
      stages={[
        { name: "B", order: 2 },
        { name: "A", order: 1, isAsync: true },
        { name: "C" },
      ]}
    />,
  );

  const items = Array.from(view.container.querySelectorAll("li")).map((node) => node.textContent?.trim());
  expect(items).toEqual(["Aasync", "B", "C"]);
  expect(view.getByText("async")).toBeTruthy();
});

test("PageSubheader renders breadcrumbs", () => {
  const view = render(
    <BrowserRouter>
      <PageSubheader breadcrumbs={[{ label: "Home", href: "/" }, { label: "Pipelines" }]} />
    </BrowserRouter>,
  );

  expect(view.getByText("Home")).toBeTruthy();
  expect(view.getByText("Pipelines")).toBeTruthy();
});
