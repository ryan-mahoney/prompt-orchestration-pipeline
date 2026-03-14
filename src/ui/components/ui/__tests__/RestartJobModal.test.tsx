import "../../__tests__/test-dom";

import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, mock, test } from "bun:test";

import { RestartJobModal } from "../RestartJobModal";

afterEach(() => {
  document.body.innerHTML = "";
});

test("RestartJobModal shows three task restart modes", () => {
  const view = render(
    <RestartJobModal open onClose={() => {}} onConfirm={() => {}} jobId="job-1" taskId="task-1" />,
  );

  expect(view.getByLabelText("Restart entire pipeline")).toBeTruthy();
  expect(view.getByLabelText("Re-run task and continue")).toBeTruthy();
  expect(view.getByLabelText("Re-run task in isolation")).toBeTruthy();
});

test("RestartJobModal defaults to 'Re-run task and continue' when taskId is provided", () => {
  const view = render(
    <RestartJobModal open onClose={() => {}} onConfirm={() => {}} jobId="job-1" taskId="task-1" />,
  );

  const radio = view.getByLabelText("Re-run task and continue") as HTMLInputElement;
  expect(radio.checked).toBe(true);
});

test("RestartJobModal confirms default task mode without changing selection", async () => {
  const onConfirm = mock((_opts: { singleTask: boolean; continueAfter?: boolean }) => {});
  const view = render(
    <RestartJobModal open onClose={() => {}} onConfirm={onConfirm} jobId="job-1" taskId="task-1" />,
  );

  await act(async () => {
    view.getByRole("button", { name: "Confirm" }).click();
  });

  expect(onConfirm).toHaveBeenCalledWith({ singleTask: true, continueAfter: true });
});

test("RestartJobModal without taskId confirms full pipeline restart", async () => {
  const onConfirm = mock((_opts: { singleTask: boolean }) => {});
  const view = render(
    <RestartJobModal open onClose={() => {}} onConfirm={onConfirm} jobId="job-1" />,
  );

  await act(async () => {
    view.getByRole("button", { name: "Confirm" }).click();
  });

  expect(onConfirm).toHaveBeenCalledWith({ singleTask: false });
});

test("RestartJobModal confirms isolation mode", async () => {
  const onConfirm = mock((_opts: { singleTask: boolean; continueAfter?: boolean }) => {});
  const view = render(
    <RestartJobModal open onClose={() => {}} onConfirm={onConfirm} jobId="job-1" taskId="task-1" />,
  );

  await act(async () => {
    view.getByLabelText("Re-run task in isolation").click();
    view.getByRole("button", { name: "Confirm" }).click();
  });

  expect(onConfirm).toHaveBeenCalledWith({ singleTask: true });
});
