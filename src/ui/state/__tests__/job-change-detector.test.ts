import { describe, expect, it } from "vitest";

import { detectJobChange, getJobLocation } from "../job-change-detector";

describe("job-change-detector", () => {
  it("detects status, seed, and task changes for job paths", () => {
    expect(
      detectJobChange("pipeline-data/current/job-1/tasks-status.json"),
    ).toEqual({
      jobId: "job-1",
      category: "status",
      filePath: "pipeline-data/current/job-1/tasks-status.json",
    });

    expect(detectJobChange("pipeline-data/complete/job-1/seed.json")?.category).toBe("seed");
    expect(
      detectJobChange("pipeline-data/pending/job-1/tasks/task-a/output.json")?.category,
    ).toBe("task");
  });

  it("rejects non-job paths and invalid job ids", () => {
    expect(detectJobChange("pipeline-data/current/job 1/tasks-status.json")).toBeNull();
    expect(detectJobChange("pipeline-data/current/job-1/notes.txt")).toBeNull();
    expect(detectJobChange("other/current/job-1/tasks-status.json")).toBeNull();
  });

  it("reports matching job locations only", () => {
    expect(getJobLocation("pipeline-data/rejected/job_1/seed.json")).toBe("rejected");
    expect(getJobLocation("pipeline-data/current/job_1/seed.json")).toBe("current");
    expect(getJobLocation("tmp/job_1/seed.json")).toBeNull();
  });
});
