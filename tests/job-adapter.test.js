import { describe, it, expect } from "vitest";
import {
  adaptJobSummary,
  adaptJobDetail,
} from "../src/ui/client/adapters/job-adapter.js";

describe("job-adapter", () => {
  it("adaptJobSummary - happy path canonical API object", () => {
    const apiJob = {
      id: "job1",
      name: "Job 1",
      status: "running",
      progress: 50,
      createdAt: "2025-10-06T00:00:00Z",
      updatedAt: "2025-10-06T01:00:00Z",
      location: "current",
      tasks: [
        {
          name: "t1",
          state: "done",
          startedAt: "2025-10-06T00:00:01Z",
          endedAt: "2025-10-06T00:05:00Z",
        },
        { name: "t2", state: "running", startedAt: "2025-10-06T00:06:00Z" },
      ],
    };

    const out = adaptJobSummary(apiJob);
    expect(out.id).toBe("job1");
    expect(out.name).toBe("Job 1");
    expect(out.status).toBe("running");
    expect(out.progress).toBe(50);
    expect(out.createdAt).toBe("2025-10-06T00:00:00Z");
    expect(out.updatedAt).toBe("2025-10-06T01:00:00Z");
    expect(out.location).toBe("current");
    expect(out.taskCount).toBe(2);
    expect(out.doneCount).toBe(1);
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks).not.toBeNull();
    expect(out.tasks.t1.state).toBe("done");
    expect(out.tasks.t2.state).toBe("running");
  });

  it("adaptJobSummary - applies sensible defaults when optional fields missing", () => {
    const apiJob = {}; // minimal/empty
    const out = adaptJobSummary(apiJob);
    expect(out.id).toBeNull();
    expect(out.name).toBe("");
    expect(out.status).toBe("pending");
    expect(out.progress).toBe(0);
    expect(out.taskCount).toBe(0);
    expect(out.doneCount).toBe(0);
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks).toEqual({});
    expect(out.__warnings).toBeDefined();
    expect(out.__warnings).toContain("missing_id");
  });

  it("adaptJobSummary - normalizes unknown task state to pending and records warning", () => {
    const apiJob = {
      id: "job-unknown-state",
      tasks: {
        compile: { state: "weird" },
        lint: { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.id).toBe("job-unknown-state");
    // tasks normalized from object to object (no longer converted to array)
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks.compile).toBeDefined();
    expect(out.tasks.compile.state).toBe("pending");
    // warnings include the unknown state marker
    expect(
      out.__warnings &&
        out.__warnings.some((w) =>
          String(w).includes("compile:unknown_state:weird")
        )
    ).toBe(true);
    // progress computed: 1 done out of 2 tasks -> 50
    expect(out.progress).toBe(50);
  });

  it("adaptJobSummary - backward compatibility with legacy/demo payloads", () => {
    const apiJob = {
      jobId: "legacy1",
      title: "Legacy Job",
      tasksStatus: {
        stepA: { state: "done" },
        stepB: { state: "done" },
      },
    };

    const out = adaptJobSummary(apiJob);
    expect(out.id).toBe("legacy1");
    expect(out.name).toBe("Legacy Job");
    // both tasks done -> complete & 100%
    expect(out.status).toBe("complete");
    expect(out.progress).toBe(100);
    expect(out.taskCount).toBe(2);
    expect(out.doneCount).toBe(2);
  });

  it("adaptJobDetail - maps detail shape to normalized detail", () => {
    const apiDetail = {
      id: "detail1",
      name: "Detail Job",
      tasks: [
        { name: "a", state: "running", startedAt: "2025-10-06T00:00:00Z" },
        { name: "b", state: "pending" },
      ],
      createdAt: "2025-10-06T00:00:00Z",
    };

    const out = adaptJobDetail(apiDetail);
    expect(out.id).toBe("detail1");
    expect(out.name).toBe("Detail Job");
    expect(out.taskCount).toBe(2);
    expect(typeof out.tasks).toBe("object");
    expect(out.tasks.a.name).toBe("a");
    expect(out.tasks.a.state).toBe("running");
    expect(out.createdAt).toBe("2025-10-06T00:00:00Z");
  });
});
