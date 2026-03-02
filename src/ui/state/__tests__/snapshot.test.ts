import { describe, expect, it, vi } from "vitest";

import { buildSnapshotFromFilesystem, composeStateSnapshot } from "../snapshot";

describe("snapshot", () => {
  it("composes default snapshots and extracts ids from variant fields", () => {
    expect(composeStateSnapshot().jobs).toEqual([]);
    expect(composeStateSnapshot({ jobs: [{ id: "x" }], meta: "2.0" })).toMatchObject({
      jobs: [{ jobId: "x" }],
      meta: { version: "2.0" },
    });
  });

  it("never throws for malformed compose inputs", () => {
    expect(() => composeStateSnapshot({ jobs: null as unknown as unknown[] })).not.toThrow();
    expect(() => composeStateSnapshot({ transformJob: () => { throw new Error("x"); } })).not.toThrow();
  });

  it("builds a sorted deduplicated filesystem snapshot from injected deps", async () => {
    const readJob = vi.fn(async (jobId: string, location: string) => ({
      ok: true,
      jobId,
      location,
      data: {
        title: `${jobId}-${location}`,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: location === "current" ? "2024-02-01T00:00:00.000Z" : "2024-01-15T00:00:00.000Z",
        tasks: { a: { state: location === "current" ? "running" : "done" } },
      },
    }));

    const snapshot = await buildSnapshotFromFilesystem({
      listAllJobs: () => ({ current: ["job-1", "job-2"], complete: ["job-1"] }),
      readJob,
      now: () => new Date("2024-03-01T00:00:00.000Z"),
    });

    expect(readJob).toHaveBeenCalledTimes(3);
    expect(snapshot).toEqual({
      jobs: [
        expect.objectContaining({ jobId: "job-1", location: "current", status: "running" }),
        expect.objectContaining({ jobId: "job-2", location: "current", status: "running" }),
      ],
      meta: { version: expect.any(String), lastUpdated: "2024-03-01T00:00:00.000Z" },
    });
  });

  it("catches individual job read failures and continues with successful reads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readJob = vi.fn(async (jobId: string, location: string) => {
      if (jobId === "bad-job") throw new Error("disk read failed");
      return {
        ok: true,
        jobId,
        location,
        data: { title: jobId, tasks: { a: { state: "done" } }, createdAt: "2024-01-01T00:00:00.000Z" },
      };
    });

    const snapshot = await buildSnapshotFromFilesystem({
      listAllJobs: () => ({ current: ["good-job", "bad-job"], complete: [] }),
      readJob,
      now: () => new Date("2024-03-01T00:00:00.000Z"),
    });

    expect(readJob).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad-job"), expect.any(Error));
    expect(snapshot.jobs).toHaveLength(1);
    const firstJob = snapshot.jobs[0];
    expect(firstJob?.jobId).toBe("good-job");
    warn.mockRestore();
  });

  it("throws when required snapshot dependencies cannot be resolved", async () => {
    // With backend modules now available, verify the error path by injecting a
    // listAllJobs that throws, simulating an unresolvable dependency at runtime.
    await expect(
      buildSnapshotFromFilesystem({
        listAllJobs: () => { throw new Error("unavailable"); },
        readJob: async () => ({ ok: false, jobId: "", location: "", message: "unavailable" }),
      }),
    ).rejects.toThrow(/unavailable/);
  });
});
