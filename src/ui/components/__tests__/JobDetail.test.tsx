import "./test-dom";

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, mock, test } from "bun:test";

import type { DagItem, JobDetail as JobDetailType, PipelineType } from "../types";

const capturedItems: DagItem[][] = [];
const decideGateMock = mock((_jobId: string, _action: string, _note?: string) => Promise.resolve({ ok: true }));

mock.module("../DAGGrid", () => ({
  default: ({ items, waitingTaskId }: { items: DagItem[]; waitingTaskId?: string | null }) => {
    capturedItems.push(items);
    return <div data-testid="dag-grid" data-waiting-task-id={waitingTaskId ?? ""} />;
  },
}));

mock.module("../../client/api", () => ({
  decideGate: decideGateMock,
}));

const JobDetail = (await import("../JobDetail")).default;

afterEach(() => {
  document.body.innerHTML = "";
  capturedItems.length = 0;
  decideGateMock.mockClear();
});

function makeJob(restartCount: number): JobDetailType {
  return {
    id: "job-1",
    name: "Job One",
    status: "running",
    tasks: {
      build: {
        name: "build",
        state: "running",
        startedAt: 1_000,
        files: { artifacts: [], logs: [], tmp: [] },
        restartCount,
      },
    },
    pipeline: { tasks: ["build"] },
    current: "build",
  };
}

const pipeline: PipelineType = {
  name: "Test",
  slug: "test",
  description: "",
  tasks: [{ name: "build" }],
};

test("JobDetail re-emits dag item when only restartCount changes", () => {
  const view = render(<JobDetail job={makeJob(1)} pipeline={pipeline} />);
  expect(capturedItems.length).toBeGreaterThan(0);
  const firstItems = capturedItems[capturedItems.length - 1] as DagItem[];
  const firstBuild = firstItems.find((item) => item.id === "build");
  expect(firstBuild?.restartCount).toBe(1);

  view.rerender(<JobDetail job={makeJob(2)} pipeline={pipeline} />);
  const lastItems = capturedItems[capturedItems.length - 1] as DagItem[];
  const secondBuild = lastItems.find((item) => item.id === "build");
  expect(secondBuild?.restartCount).toBe(2);
  expect(secondBuild).not.toBe(firstBuild);
});

test("JobDetail renders gate controls and approves a gate", async () => {
  const job: JobDetailType = {
    ...makeJob(0),
    status: "waiting",
    gate: {
      afterTask: "build",
      message: "Review build output",
      artifacts: ["build-output.md"],
      requestedAt: "2026-06-12T12:00:00.000Z",
    },
  };

  const view = render(<JobDetail job={job} pipeline={pipeline} />);

  expect(view.getByText("Review build output")).toBeTruthy();
  expect(view.getByText("After task: build")).toBeTruthy();
  expect(view.getByRole("link", { name: "build-output.md" }).getAttribute("href")).toContain("/api/jobs/job-1/tasks/build/file?");
  expect(view.getByTestId("dag-grid").getAttribute("data-waiting-task-id")).toBe("build");

  fireEvent.click(view.getByRole("button", { name: "Approve gate" }));

  expect(view.getByRole("button", { name: "Approve gate" }).getAttribute("disabled")).not.toBeNull();
  await waitFor(() => expect(decideGateMock).toHaveBeenCalledWith("job-1", "approve", undefined));
});

test("JobDetail rejects a gate with an optional note", async () => {
  const originalPrompt = window.prompt;
  window.prompt = mock(() => "not ready") as unknown as typeof window.prompt;

  try {
    const view = render(<JobDetail job={{
      ...makeJob(0),
      status: "waiting",
      gate: {
        afterTask: "build",
        message: "Review build output",
        requestedAt: "2026-06-12T12:00:00.000Z",
      },
    }} pipeline={pipeline} />);

    fireEvent.click(view.getByRole("button", { name: "Reject gate" }));

    await waitFor(() => expect(decideGateMock).toHaveBeenCalledWith("job-1", "reject", "not ready"));
  } finally {
    window.prompt = originalPrompt;
  }
});

test("JobDetail cancels gate rejection when the prompt is cancelled", () => {
  const originalPrompt = window.prompt;
  window.prompt = mock(() => null) as unknown as typeof window.prompt;

  try {
    const view = render(<JobDetail job={{
      ...makeJob(0),
      status: "waiting",
      gate: {
        afterTask: "build",
        message: "Review build output",
        requestedAt: "2026-06-12T12:00:00.000Z",
      },
    }} pipeline={pipeline} />);

    fireEvent.click(view.getByRole("button", { name: "Reject gate" }));

    expect(decideGateMock).not.toHaveBeenCalled();
  } finally {
    window.prompt = originalPrompt;
  }
});
