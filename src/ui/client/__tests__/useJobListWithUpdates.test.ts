import { describe, expect, it } from "vitest";

import { applyJobEvent, shouldRefetchForListEvent } from "../hooks/useJobListWithUpdates";
import type { NormalizedJobSummary } from "../types";

function makeJob(jobId: string, fields: Partial<NormalizedJobSummary> = {}): NormalizedJobSummary {
  return {
    id: jobId,
    jobId,
    name: jobId,
    status: "pending",
    progress: 0,
    taskCount: 0,
    doneCount: 0,
    location: "current",
    tasks: {},
    current: null,
    costsSummary: {
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      totalInputCost: 0,
      totalOutputCost: 0,
    },
    totalCost: 0,
    totalTokens: 0,
    __warnings: [],
    displayCategory: "current",
    ...fields,
  };
}

describe("useJobListWithUpdates helpers", () => {
  it("adds jobs on job:created", () => {
    const next = applyJobEvent([], { type: "job:created", data: { jobId: "job-1", tasks: {} } });
    expect(next).toHaveLength(1);
    expect(next[0]?.jobId).toBe("job-1");
  });

  it("removes jobs on job:removed", () => {
    const next = applyJobEvent([makeJob("job-1")], { type: "job:removed", data: { jobId: "job-1", tasks: {} } });
    expect(next).toEqual([]);
  });

  it("merges jobs on job:updated", () => {
    const next = applyJobEvent([makeJob("job-1", { name: "old" })], {
      type: "job:updated",
      data: { jobId: "job-1", name: "new", tasks: {} },
    });
    expect(next[0]?.name).toBe("new");
  });

  it("reuses the previous reference when nothing changes", () => {
    const jobs = [makeJob("job-1")];
    const next = applyJobEvent(jobs, {
      type: "job:updated",
      data: { jobId: "job-1", tasks: {} },
    });
    expect(next).toBe(jobs);
  });

  it("flags list refetch events", () => {
    expect(shouldRefetchForListEvent("seed:uploaded")).toBe(true);
    expect(shouldRefetchForListEvent("job:updated")).toBe(false);
  });
});
