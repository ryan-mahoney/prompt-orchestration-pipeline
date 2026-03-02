import "../../components/__tests__/test-dom";

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, mock, test } from "bun:test";

mock.module("../../client/hooks/useJobListWithUpdates", () => ({
  useJobListWithUpdates: () => ({
    data: [
      {
        id: "job-1",
        jobId: "job-1",
        name: "Job One",
        status: "running",
        progress: 50,
        taskCount: 2,
        doneCount: 1,
        location: "current",
        tasks: { task1: { name: "task1", state: "running", files: { artifacts: [], logs: [], tmp: [] } } },
        current: "task1",
        displayCategory: "current",
      },
      {
        id: "job-2",
        jobId: "job-2",
        name: "Job Two",
        status: "failed",
        progress: 100,
        taskCount: 1,
        doneCount: 1,
        location: "current",
        tasks: {},
        current: null,
        displayCategory: "errors",
      },
    ],
    error: null,
  }),
}));

afterEach(() => {
  document.body.innerHTML = "";
});

test("PromptPipelineDashboard renders tabs", async () => {
  const { default: PromptPipelineDashboard } = await import("../PromptPipelineDashboard");
  const view = render(
    <MemoryRouter>
      <PromptPipelineDashboard />
    </MemoryRouter>,
  );

  expect(view.getAllByText("Current (1)")[0]).toBeTruthy();
  expect(view.getAllByText("Errors (1)")[0]).toBeTruthy();
  expect(view.getByText("Job One")).toBeTruthy();
});
