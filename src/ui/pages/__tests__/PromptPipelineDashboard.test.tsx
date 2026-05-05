import "../../components/__tests__/test-dom";

import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import type { JobConcurrencyApiStatus } from "../../client/types";

const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

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

let concurrencyStatus: JobConcurrencyApiStatus | null = null;
function setConcurrency(status: JobConcurrencyApiStatus | null) {
  concurrencyStatus = status;
}

function emptyStatus(): JobConcurrencyApiStatus {
  return {
    limit: 3,
    runningCount: 0,
    availableSlots: 3,
    queuedCount: 0,
    activeJobs: [],
    queuedJobs: [],
    staleSlots: [],
  };
}

class MockEventSource {
  public onerror: ((event: Event) => void) | null = null;

  addEventListener(): void {}

  close(): void {}
}

function installConcurrencyFetch(): void {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true, data: concurrencyStatus }))),
  ) as unknown as typeof fetch;
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
}

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
  setConcurrency(emptyStatus());
  installConcurrencyFetch();
});

afterEach(() => {
  document.body.innerHTML = "";
  globalThis.localStorage = originalLocalStorage;
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
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

test("PromptPipelineDashboard shows the Concurrency tab", async () => {
  const { default: PromptPipelineDashboard } = await import("../PromptPipelineDashboard");
  const view = render(
    <MemoryRouter>
      <PromptPipelineDashboard />
    </MemoryRouter>,
  );

  expect(view.getByText("Concurrency")).toBeTruthy();
});

test("Concurrency tab renders capacity metrics from the hook", async () => {
  setConcurrency({
    limit: 7,
    runningCount: 4,
    availableSlots: 3,
    queuedCount: 5,
    activeJobs: [],
    queuedJobs: [],
    staleSlots: [],
  });
  const { default: PromptPipelineDashboard } = await import("../PromptPipelineDashboard");
  const view = render(
    <MemoryRouter>
      <PromptPipelineDashboard />
    </MemoryRouter>,
  );

  fireEvent.click(view.getByText("Concurrency"));

  function metricValue(label: string): string | null {
    const dt = view.getAllByText(label).find((node) => node.tagName === "DT");
    return dt?.parentElement?.querySelector("dd")?.textContent ?? null;
  }

  await waitFor(() => expect(metricValue("Limit")).toBe("7"));
  expect(metricValue("Running")).toBe("4");
  expect(metricValue("Available")).toBe("3");
  expect(metricValue("Queued")).toBe("5");
});

test("Concurrency tab renders active jobs when present", async () => {
  setConcurrency({
    limit: 2,
    runningCount: 1,
    availableSlots: 1,
    queuedCount: 0,
    activeJobs: [
      {
        jobId: "active-1",
        pid: 4321,
        acquiredAt: "2026-05-05T12:00:00.000Z",
        source: "orchestrator",
      },
    ],
    queuedJobs: [],
    staleSlots: [],
  });
  const { default: PromptPipelineDashboard } = await import("../PromptPipelineDashboard");
  const view = render(
    <MemoryRouter>
      <PromptPipelineDashboard />
    </MemoryRouter>,
  );

  fireEvent.click(view.getByText("Concurrency"));

  await waitFor(() => expect(view.getByText("active-1")).toBeTruthy());
  expect(view.getByText("orchestrator")).toBeTruthy();
  expect(view.getByText("4321")).toBeTruthy();
  expect(view.getByText(/Active jobs \(1\)/)).toBeTruthy();
});

test("Concurrency tab renders queued jobs when present", async () => {
  setConcurrency({
    limit: 2,
    runningCount: 0,
    availableSlots: 2,
    queuedCount: 1,
    activeJobs: [],
    queuedJobs: [
      {
        jobId: "queued-1",
        queuedAt: "2026-05-05T11:00:00.000Z",
        name: "Queued Job",
        pipeline: "demo-pipeline",
      },
    ],
    staleSlots: [],
  });
  const { default: PromptPipelineDashboard } = await import("../PromptPipelineDashboard");
  const view = render(
    <MemoryRouter>
      <PromptPipelineDashboard />
    </MemoryRouter>,
  );

  fireEvent.click(view.getByText("Concurrency"));

  await waitFor(() => expect(view.getByText("queued-1")).toBeTruthy());
  expect(view.getByText("Queued Job")).toBeTruthy();
  expect(view.getByText("demo-pipeline")).toBeTruthy();
  expect(view.getByText(/Queued jobs \(1\)/)).toBeTruthy();
});

test("Concurrency tab renders stale slot warnings when present", async () => {
  setConcurrency({
    limit: 2,
    runningCount: 1,
    availableSlots: 1,
    queuedCount: 0,
    activeJobs: [],
    queuedJobs: [],
    staleSlots: [
      { jobId: "stale-1", reason: "dead_pid" },
      { jobId: "stale-2", reason: "invalid_json" },
    ],
  });
  const { default: PromptPipelineDashboard } = await import("../PromptPipelineDashboard");
  const view = render(
    <MemoryRouter>
      <PromptPipelineDashboard />
    </MemoryRouter>,
  );

  fireEvent.click(view.getByText("Concurrency"));

  await waitFor(() => expect(view.getByText(/Stale slots \(2\)/)).toBeTruthy());
  expect(view.getByText("stale-1")).toBeTruthy();
  expect(view.getByText("Process no longer running")).toBeTruthy();
  expect(view.getByText("stale-2")).toBeTruthy();
  expect(view.getByText("Lease file is not valid JSON")).toBeTruthy();
});
