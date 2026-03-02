import "../../__tests__/test-dom";

import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, test } from "bun:test";

import { ToastProvider, useToast } from "../Toast";

function ToastProbe() {
  const toast = useToast();

  return (
    <button type="button" onClick={() => toast.success("done")}>
      Trigger
    </button>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("ToastProvider exposes success helper", async () => {
  const view = render(
    <ToastProvider>
      <ToastProbe />
    </ToastProvider>,
  );

  await act(async () => {
    view.getByRole("button", { name: "Trigger" }).click();
  });

  expect(view.getByText("done")).toBeTruthy();
});
