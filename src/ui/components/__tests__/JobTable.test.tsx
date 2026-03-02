import "./test-dom";

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, mock, test } from "bun:test";

import JobTable from "../JobTable";
import type { JobSummary } from "../types";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    jobId: "job-1",
    name: "Job One",
    status: "running",
    progress: 50,
    taskCount: 2,
    doneCount: 1,
    location: "current",
    tasks: {
      task1: { name: "task1", state: "running", startedAt: 1_000, files: { artifacts: [], logs: [], tmp: [] } },
    },
    current: "task1",
    displayCategory: "current",
    ...overrides,
  };
}

test("JobTable renders invalid job rows as non interactive", () => {
  const onOpenJob = mock((_jobId: string) => {});
  const view = render(
    <MemoryRouter>
      <JobTable jobs={[makeJob(), makeJob({ id: "", jobId: "job-2", name: "Job Two" })]} onOpenJob={onOpenJob} />
    </MemoryRouter>,
  );

  const rows = Array.from(view.container.querySelectorAll("tbody tr"));
  expect(rows[0]?.getAttribute("tabindex")).toBe("0");
  expect(rows[1]?.getAttribute("tabindex")).toBe("-1");
  expect(rows[1]?.className).toContain("cursor-not-allowed");
});
