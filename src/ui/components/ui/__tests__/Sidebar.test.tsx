import "../../__tests__/test-dom";

import { render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

import { Sidebar } from "../Sidebar";

afterEach(() => {
  document.body.innerHTML = "";
});

test("Sidebar renders dialog content when open", () => {
  const view = render(
    <Sidebar open onOpenChange={() => {}} title="Panel">
      <div>Body</div>
    </Sidebar>,
  );

  expect(view.getByText("Panel")).toBeTruthy();
  expect(view.getByText("Body")).toBeTruthy();
});

test("Sidebar does not render content when closed", () => {
  const view = render(
    <Sidebar open={false} onOpenChange={() => {}} title="Panel">
      <div>Body</div>
    </Sidebar>,
  );

  expect(view.queryByText("Body")).toBeNull();
});
