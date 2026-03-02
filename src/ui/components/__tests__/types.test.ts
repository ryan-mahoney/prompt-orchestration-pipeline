import { expect, test } from "bun:test";

import type { DagItem, JobSummary, TaskProposal, Toast } from "../types";

test("DagItem type accepts valid shape", () => {
  const item: DagItem = {
    id: "extract",
    status: "running",
    stage: "processing",
    title: "Extract",
    subtitle: "gpt-4 · 1.2k tokens",
    body: null,
    startedAt: "2024-01-01T00:00:00Z",
    endedAt: null,
  };

  expect(item.id).toBe("extract");
});

test("JobSummary type accepts valid shape", () => {
  const job: JobSummary = {
    id: "j1",
    jobId: "j1",
    name: "Test",
    status: "running",
    progress: 50,
    taskCount: 4,
    doneCount: 2,
    location: "current",
    tasks: {},
    current: "task-1",
    displayCategory: "current",
  };

  expect(job.displayCategory).toBe("current");
});

test("TaskProposal and Toast types accept valid shapes", () => {
  const proposal: TaskProposal = {
    filename: "extract.ts",
    taskName: "extract",
    code: "export default {}",
    proposalBlock: "[TASK_PROPOSAL]",
    created: false,
    error: null,
    path: null,
  };
  const toast: Toast = {
    id: "toast-1",
    type: "success",
    message: "done",
  };

  expect(proposal.taskName).toBe("extract");
  expect(toast.type).toBe("success");
});
