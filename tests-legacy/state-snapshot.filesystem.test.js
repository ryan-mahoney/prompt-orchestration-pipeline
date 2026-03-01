import { describe, it, expect } from "vitest";
import { buildSnapshotFromFilesystem } from "../src/ui/state-snapshot.js";

describe("buildSnapshotFromFilesystem", () => {
  it("returns empty snapshot when there are no jobs", async () => {
    const snapshot = await buildSnapshotFromFilesystem({
      listAllJobs: async () => ({ current: [], complete: [] }),
      readJob: async () => ({ ok: true, data: {} }),
      transformMultipleJobs: () => [],
      now: () => new Date("2025-10-10T07:20:00.000Z"),
      paths: {},
    });

    expect(snapshot).toHaveProperty("jobs");
    expect(Array.isArray(snapshot.jobs)).toBe(true);
    expect(snapshot.jobs.length).toBe(0);
    expect(snapshot.meta).toBeDefined();
    expect(snapshot.meta.version).toBe("1");
    expect(snapshot.meta.lastUpdated).toBe("2025-10-10T07:20:00.000Z");
  });

  it("deduplicates jobs, preferring current over complete", async () => {
    const listAllJobs = async () => ({
      current: ["a"],
      complete: ["a", "b"],
    });

    const readResults = [
      { ok: true, data: { id: "a" }, jobId: "a", location: "current" },
      { ok: true, data: { id: "a" }, jobId: "a", location: "complete" },
      { ok: true, data: { id: "b" }, jobId: "b", location: "complete" },
    ];

    const readJob = async (id, location) =>
      readResults.find((r) => r.jobId === id && r.location === location) || {
        ok: false,
        jobId: id,
        location,
      };

    const transformMultipleJobs = (reads) =>
      (reads || [])
        .filter((r) => r && r.ok)
        .map((r, idx) => ({
          id: r.jobId,
          name: r.data?.name || `Job ${r.jobId}`,
          status: "pending",
          progress: 0,
          createdAt: "2025-10-07T06:11:07.544Z",
          updatedAt:
            r.jobId === "b"
              ? "2025-10-09T00:00:00.000Z"
              : "2025-10-08T00:00:00.000Z",
          location: r.location,
        }));

    const snapshot = await buildSnapshotFromFilesystem({
      listAllJobs,
      readJob,
      transformMultipleJobs,
      now: () => new Date("2025-10-10T07:20:00.000Z"),
    });

    // Expect order: 'a' (from current) then 'b' (from complete)
    expect(snapshot.jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(snapshot.jobs[0].location).toBe("current");
    expect(snapshot.jobs[1].location).toBe("complete");
  });
});
