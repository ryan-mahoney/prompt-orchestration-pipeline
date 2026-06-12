import { describe, it, expect, spyOn } from "bun:test";
import {
  TaskState,
  JobStatus,
  JobLocation,
  VALID_TASK_STATES,
  VALID_JOB_STATUSES,
  VALID_JOB_LOCATIONS,
  normalizeTaskState,
  normalizeJobStatus,
  deriveJobStatusFromTasks,
} from "../statuses";

describe("TaskState", () => {
  it("has correct string values", () => {
    expect(TaskState.PENDING).toBe("pending");
    expect(TaskState.RUNNING).toBe("running");
    expect(TaskState.DONE).toBe("done");
    expect(TaskState.FAILED).toBe("failed");
    expect(TaskState.SKIPPED).toBe("skipped");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(TaskState)).toBe(true);
  });
});

describe("JobStatus", () => {
  it("has correct string values", () => {
    expect(JobStatus.PENDING).toBe("pending");
    expect(JobStatus.RUNNING).toBe("running");
    expect(JobStatus.FAILED).toBe("failed");
    expect(JobStatus.COMPLETE).toBe("complete");
    expect(JobStatus.WAITING).toBe("waiting");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(JobStatus)).toBe(true);
  });
});

describe("JobLocation", () => {
  it("has correct string values", () => {
    expect(JobLocation.PENDING).toBe("pending");
    expect(JobLocation.CURRENT).toBe("current");
    expect(JobLocation.COMPLETE).toBe("complete");
    expect(JobLocation.REJECTED).toBe("rejected");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(JobLocation)).toBe(true);
  });
});

describe("VALID_TASK_STATES", () => {
  it("contains all valid task states", () => {
    expect(VALID_TASK_STATES.has("pending")).toBe(true);
    expect(VALID_TASK_STATES.has("running")).toBe(true);
    expect(VALID_TASK_STATES.has("done")).toBe(true);
    expect(VALID_TASK_STATES.has("failed")).toBe(true);
    expect(VALID_TASK_STATES.has("skipped")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(VALID_TASK_STATES.has("invalid")).toBe(false);
    expect(VALID_TASK_STATES.has("complete")).toBe(false);
  });
});

describe("VALID_JOB_STATUSES", () => {
  it("contains all valid job statuses", () => {
    expect(VALID_JOB_STATUSES.has("pending")).toBe(true);
    expect(VALID_JOB_STATUSES.has("running")).toBe(true);
    expect(VALID_JOB_STATUSES.has("failed")).toBe(true);
    expect(VALID_JOB_STATUSES.has("complete")).toBe(true);
    expect(VALID_JOB_STATUSES.has("waiting")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(VALID_JOB_STATUSES.has("done")).toBe(false);
    expect(VALID_JOB_STATUSES.has("invalid")).toBe(false);
  });
});

describe("VALID_JOB_LOCATIONS", () => {
  it("contains all valid job locations", () => {
    expect(VALID_JOB_LOCATIONS.has("pending")).toBe(true);
    expect(VALID_JOB_LOCATIONS.has("current")).toBe(true);
    expect(VALID_JOB_LOCATIONS.has("complete")).toBe(true);
    expect(VALID_JOB_LOCATIONS.has("rejected")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(VALID_JOB_LOCATIONS.has("invalid")).toBe(false);
    expect(VALID_JOB_LOCATIONS.has("done")).toBe(false);
  });
});

describe("normalizeTaskState", () => {
  it("handles synonym: error → failed", () => {
    expect(normalizeTaskState("error")).toBe("failed");
  });

  it("handles synonym: succeeded → done", () => {
    expect(normalizeTaskState("succeeded")).toBe("done");
  });

  it("is case-insensitive", () => {
    expect(normalizeTaskState("RUNNING")).toBe("running");
    expect(normalizeTaskState("PENDING")).toBe("pending");
  });

  it("returns pending for non-string input", () => {
    expect(normalizeTaskState(42)).toBe("pending");
    expect(normalizeTaskState(null)).toBe("pending");
    expect(normalizeTaskState(undefined)).toBe("pending");
    expect(normalizeTaskState({})).toBe("pending");
  });

  it("returns pending for unrecognized strings", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    expect(normalizeTaskState("bogus-task-state")).toBe("pending");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("bogus-task-state");
    warn.mockRestore();
  });

  it("warns once per unknown string", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    expect(normalizeTaskState("mystery-task-state")).toBe("pending");
    expect(normalizeTaskState("mystery-task-state")).toBe("pending");
    expect(normalizeTaskState("another-mystery-task-state")).toBe("pending");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("mystery-task-state");
    expect(warn.mock.calls[1]?.[0]).toContain("another-mystery-task-state");
    warn.mockRestore();
  });

  it("passes through valid values", () => {
    expect(normalizeTaskState("done")).toBe("done");
    expect(normalizeTaskState("failed")).toBe("failed");
    expect(normalizeTaskState("running")).toBe("running");
    expect(normalizeTaskState("pending")).toBe("pending");
    expect(normalizeTaskState("skipped")).toBe("skipped");
  });

  it("is idempotent", () => {
    expect(normalizeTaskState("done")).toBe(normalizeTaskState(normalizeTaskState("done")));
    expect(normalizeTaskState("failed")).toBe(normalizeTaskState(normalizeTaskState("failed")));
  });
});

describe("normalizeJobStatus", () => {
  it("handles synonym: completed → complete", () => {
    expect(normalizeJobStatus("completed")).toBe("complete");
  });

  it("handles synonym: error → failed", () => {
    expect(normalizeJobStatus("error")).toBe("failed");
  });

  it("returns pending for non-string input", () => {
    expect(normalizeJobStatus(null)).toBe("pending");
    expect(normalizeJobStatus(undefined)).toBe("pending");
    expect(normalizeJobStatus(42)).toBe("pending");
  });

  it("passes through valid values", () => {
    expect(normalizeJobStatus("pending")).toBe("pending");
    expect(normalizeJobStatus("running")).toBe("running");
    expect(normalizeJobStatus("failed")).toBe("failed");
    expect(normalizeJobStatus("complete")).toBe("complete");
    expect(normalizeJobStatus("waiting")).toBe("waiting");
  });

  it("returns pending for unrecognized strings and warns once", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    expect(normalizeJobStatus("mystery-job-status")).toBe("pending");
    expect(normalizeJobStatus("mystery-job-status")).toBe("pending");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("mystery-job-status");
    warn.mockRestore();
  });

  it("is idempotent", () => {
    expect(normalizeJobStatus("complete")).toBe(normalizeJobStatus(normalizeJobStatus("complete")));
  });
});

describe("deriveJobStatusFromTasks", () => {
  it("returns failed when any task is failed (failed priority)", () => {
    expect(deriveJobStatusFromTasks([{ state: "failed" }, { state: "done" }])).toBe("failed");
  });

  it("returns running when any task is running (running priority)", () => {
    expect(deriveJobStatusFromTasks([{ state: "running" }, { state: "done" }])).toBe("running");
  });

  it("returns complete when all tasks are done", () => {
    expect(deriveJobStatusFromTasks([{ state: "done" }, { state: "done" }])).toBe("complete");
  });

  it("returns complete when all tasks are done or skipped", () => {
    expect(deriveJobStatusFromTasks([{ state: "done" }, { state: "skipped" }])).toBe("complete");
    expect(deriveJobStatusFromTasks([{ state: "skipped" }, { state: "skipped" }])).toBe("complete");
  });

  it("returns pending when mixed with pending tasks", () => {
    expect(deriveJobStatusFromTasks([{ state: "pending" }, { state: "done" }])).toBe("pending");
    expect(deriveJobStatusFromTasks([{ state: "skipped" }, { state: "pending" }])).toBe("pending");
  });

  it("returns pending for empty array", () => {
    expect(deriveJobStatusFromTasks([])).toBe("pending");
  });

  it("returns pending for non-array input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveJobStatusFromTasks("not-array" as any)).toBe("pending");
  });

  it("failed takes priority over running", () => {
    expect(
      deriveJobStatusFromTasks([{ state: "failed" }, { state: "running" }, { state: "done" }]),
    ).toBe("failed");
  });

  it("treats skipped as done-equivalent in status priority", () => {
    expect(deriveJobStatusFromTasks([{ state: "skipped" }, { state: "failed" }])).toBe("failed");
    expect(deriveJobStatusFromTasks([{ state: "skipped" }, { state: "running" }])).toBe("running");
  });
});
