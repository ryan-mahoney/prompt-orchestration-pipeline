import { describe, expect, it, vi } from "vitest";

import {
  computeJobStatus,
  getTransformationStats,
  transformJobStatus,
  transformMultipleJobs,
  transformTasks,
} from "../status-transformer";

describe("status-transformer", () => {
  it("returns pending status for invalid task input", () => {
    expect(computeJobStatus({})).toEqual({ status: "pending", progress: 0 });
    expect(computeJobStatus(null)).toEqual({ status: "pending", progress: 0 });
  });

  it("derives complete status and normalizes task collections", () => {
    expect(
      computeJobStatus({
        a: { state: "done" },
        b: { state: "done" },
      }),
    ).toEqual({ status: "complete", progress: 100 });

    expect(transformTasks([{ name: "one", state: "running" }])).toMatchObject({
      one: { state: "running" },
    });
    expect(transformTasks({ alpha: { state: "error" } })).toMatchObject({
      alpha: { state: "failed" },
    });
    expect(transformTasks("bad")).toEqual({});
  });

  it("returns null for invalid jobs and preserves id aliases", () => {
    expect(transformJobStatus(null, "job-1", "current")).toBeNull();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const job = transformJobStatus(
      {
        jobId: "different",
        title: "Title",
        tasks: { alpha: { state: "done" } },
      },
      "job-1",
      "current",
    );

    expect(job?.id).toBe("job-1");
    expect(job?.jobId).toBe("job-1");
    expect(job?.name).toBe("Title");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("filters failed reads and computes transformation stats", () => {
    const transformed = transformMultipleJobs([
      { ok: true, data: { tasks: { a: { state: "done" } } }, jobId: "job-1", location: "current" },
      { ok: false, jobId: "job-2", location: "current" },
    ]);

    expect(transformed).toHaveLength(1);
    expect(
      getTransformationStats(
        [
          { ok: true, data: { tasks: { a: { state: "done" } } }, jobId: "job-1", location: "current" },
          { ok: false, jobId: "job-2", location: "current" },
        ],
        transformed,
      ),
    ).toEqual({
      totalRead: 2,
      successfulReads: 1,
      successfulTransforms: 1,
      failedTransforms: 0,
      transformationRate: 1,
      statusDistribution: { complete: 1 },
    });
  });
});
