import { describe, expect, it, vi } from "vitest";

import { JobIndex } from "../job-index";

describe("job-index", () => {
  it("stores, updates, and removes jobs", () => {
    const index = new JobIndex();
    index.updateJob("job-1", { title: "Job 1" }, "current", "/tmp/job-1");
    expect(index.getJob("job-1")).toMatchObject({ title: "Job 1", location: "current" });
    expect(index.hasJob("job-1")).toBe(true);
    index.removeJob("job-1");
    expect(index.hasJob("job-1")).toBe(false);
    index.clear();
    expect(index.getAllJobs()).toEqual([]);
  });

  it("prevents concurrent refresh work", async () => {
    const index = new JobIndex();
    const refreshSpy = vi
      .spyOn(index, "updateJob")
      .mockImplementation(() => undefined);

    const module = await import("../job-scanner");
    const reader = await import("../job-reader");
    vi.spyOn(module, "listAllJobs").mockResolvedValue({ current: ["job-1"], complete: [] });
    vi.spyOn(reader, "readMultipleJobs").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve([{ ok: true, jobId: "job-1", data: {}, location: "current", path: "/tmp/job-1" }]),
            5,
          ),
        ),
    );

    await Promise.all([index.refresh(), index.refresh()]);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
