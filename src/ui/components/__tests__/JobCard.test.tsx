import "./test-dom";

import { render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

import JobCard from "../JobCard";
import type { JobSummary } from "../types";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    jobId: "job-1",
    name: "Job One",
    status: "waiting",
    progress: 50,
    taskCount: 2,
    doneCount: 1,
    location: "current",
    tasks: {
      review: { name: "review", state: "done", files: { artifacts: [], logs: [], tmp: [] } },
      deploy: { name: "deploy", state: "pending", files: { artifacts: [], logs: [], tmp: [] } },
    },
    current: "review",
    displayCategory: "current",
    ...overrides,
  };
}

test("JobCard renders waiting status without running progress styling", () => {
  const view = render(
    <JobCard
      job={makeJob()}
      pipeline={null}
      onClick={() => undefined}
      progressPct={50}
      overallElapsedMs={12_000}
    />,
  );

  expect(view.getByText("waiting")).toBeTruthy();
  expect(view.container.querySelector(".bg-gray-400")).not.toBeNull();
  expect(view.container.querySelector(".bg-brand-600")).toBeNull();
});
