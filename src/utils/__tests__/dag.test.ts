import { describe, it, expect } from "bun:test";
import { computeDagItems } from "../dag";
import type { JobDetail, TaskStateObject } from "../../ui/components/types";

function makeJob(tasks: TaskStateObject[]): JobDetail {
  return {
    id: "job-1",
    name: "job-1",
    status: "running",
    tasks,
    pipeline: { tasks: tasks.map((t) => t.name) },
    current: null,
  };
}

describe("computeDagItems restartCount", () => {
  it("propagates restartCount from a task", () => {
    const job = makeJob([{ name: "t1", state: "done", restartCount: 3 }]);
    const items = computeDagItems(job, { tasks: ["t1"] });
    expect(items[0]?.restartCount).toBe(3);
  });

  it("defaults restartCount to 0 when the task lacks it", () => {
    const job = makeJob([{ name: "t1", state: "done" }]);
    const items = computeDagItems(job, { tasks: ["t1"] });
    expect(items[0]?.restartCount).toBe(0);
  });

  it("defaults restartCount to 0 when the pipeline task is missing from job.tasks", () => {
    const job = makeJob([]);
    const items = computeDagItems(job, { tasks: ["t1"] });
    expect(items).toHaveLength(1);
    expect(items[0]?.restartCount).toBe(0);
  });
});
