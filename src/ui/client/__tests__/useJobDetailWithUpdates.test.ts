import { describe, expect, it } from "vitest";

import {
  applyDetailEvent,
  extractJobDetail,
  matchesJobTasksStatusPath,
  REFRESH_DEBOUNCE_MS,
} from "../hooks/useJobDetailWithUpdates";
import type { NormalizedJobDetail } from "../types";

function makeDetail(jobId: string): NormalizedJobDetail {
  return {
    id: jobId,
    jobId,
    name: jobId,
    status: "pending",
    progress: 0,
    taskCount: 2,
    doneCount: 0,
    location: "current",
    tasks: {
      build: {
        name: "build",
        state: "pending",
        startedAt: null,
        endedAt: null,
        files: { artifacts: [], logs: [], tmp: [] },
      },
      test: {
        name: "test",
        state: "pending",
        startedAt: null,
        endedAt: null,
        files: { artifacts: [], logs: [], tmp: [] },
      },
    },
    displayCategory: "current",
  };
}

describe("useJobDetailWithUpdates helpers", () => {
  it("filters events by jobId", () => {
    const detail = makeDetail("job-1");
    expect(applyDetailEvent(detail, {
      type: "job:updated",
      data: { jobId: "job-2", name: "other" },
    })).toBe(detail);
  });

  it("merges task updates and recomputes progress", () => {
    const detail = makeDetail("job-1");
    const next = applyDetailEvent(detail, {
      type: "task:updated",
      data: { jobId: "job-1", taskName: "build", task: { state: "done" } },
    });

    expect(next.tasks["build"]?.state).toBe("done");
    expect(next.doneCount).toBe(1);
    expect(next.progress).toBe(50);
  });

  it("matches state-change paths for the active job", () => {
    expect(matchesJobTasksStatusPath("pipeline-data/current/job-1/tasks-status.json", "job-1")).toBe(true);
    expect(matchesJobTasksStatusPath("pipeline-data/current/job-2/tasks-status.json", "job-1")).toBe(false);
  });

  it("extracts wrapped job detail payloads", () => {
    expect(extractJobDetail({ ok: true, data: { jobId: "job-1" } })).toEqual({ jobId: "job-1" });
  });

  it("exports the detail debounce constant", () => {
    expect(REFRESH_DEBOUNCE_MS).toBe(200);
  });
});
