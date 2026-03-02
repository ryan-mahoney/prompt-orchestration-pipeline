import "../../__tests__/test-dom";

import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, mock, test } from "bun:test";

import { StopJobModal } from "../StopJobModal";

afterEach(() => {
  document.body.innerHTML = "";
});

test("StopJobModal renders multiple running jobs in selector", () => {
  const view = render(
    <StopJobModal
      isOpen
      onClose={() => {}}
      onConfirm={() => {}}
      runningJobs={[
        { id: "j1", name: "Job One" },
        { id: "j2", name: "Job Two" },
      ]}
    />,
  );

  expect(view.getByRole("option", { name: "Job One" })).toBeTruthy();
  expect(view.getByRole("option", { name: "Job Two" })).toBeTruthy();
});

test("StopJobModal confirms selected job", async () => {
  const onConfirm = mock((_jobId: string) => {});
  const view = render(
    <StopJobModal
      isOpen
      onClose={() => {}}
      onConfirm={onConfirm}
      runningJobs={[
        { id: "j1", name: "Job One" },
        { id: "j2", name: "Job Two" },
      ]}
    />,
  );

  await act(async () => {
    const select = view.getByRole("combobox", { name: "Running jobs" }) as HTMLSelectElement;
    select.value = "j2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    view.getByRole("button", { name: "Stop" }).click();
  });

  expect(onConfirm).toHaveBeenCalledWith("j2");
});
