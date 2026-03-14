import "../../components/__tests__/test-dom";

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const originalLocalStorage = globalThis.localStorage;

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

beforeEach(() => {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
});

afterEach(() => {
  document.body.innerHTML = "";
  globalThis.localStorage = originalLocalStorage;
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
