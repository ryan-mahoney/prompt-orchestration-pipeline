import { describe, it, expect } from "vitest";
import { composeStateSnapshot } from "../src/ui/state-snapshot.js";

describe("composeStateSnapshot", () => {
  it("returns an object with jobs array and meta object", () => {
    const res = composeStateSnapshot({
      jobs: [{ id: "1", status: "pending" }],
      meta: { version: "2" },
    });

    expect(res).toHaveProperty("jobs");
    expect(Array.isArray(res.jobs)).toBe(true);
    expect(res.jobs.length).toBe(1);
    expect(res).toHaveProperty("meta");
    expect(res.meta.version).toBe("2");
    expect(typeof res.meta.lastUpdated).toBe("string");
  });

  it("normalizes job items with required fields", () => {
    const input = [
      {
        jobId: 123,
        status: "running",
        title: "Test job",
        lastUpdated: "2020-01-01T00:00:00Z",
      },
    ];

    const res = composeStateSnapshot({ jobs: input });
    const job = res.jobs[0];

    expect(job.jobId).toBe("123");
    expect(job.status).toBe("running");
    expect(job.title).toBe("Test job");
    expect(job.updatedAt).toBe("2020-01-01T00:00:00Z");
  });

  it("handles empty or missing sources", () => {
    const res = composeStateSnapshot();
    expect(Array.isArray(res.jobs)).toBe(true);
    expect(res.jobs.length).toBe(0);
    expect(res.meta).toBeDefined();
    expect(typeof res.meta.lastUpdated).toBe("string");
    expect(res.meta.version).toBeDefined();
  });

  it("does not mutate input arrays/objects (immutability)", () => {
    const inputJobs = [{ id: "1", status: "ready", title: "T" }];
    const inputCopy = JSON.parse(JSON.stringify(inputJobs));

    composeStateSnapshot({ jobs: inputJobs });

    expect(inputJobs).toEqual(inputCopy);
  });

  it("accepts a transformJob function to customize normalization", () => {
    const jobs = [{ uid: "a", s: "ok" }];
    const res = composeStateSnapshot({
      jobs,
      transformJob: (j) => ({ jobId: j.uid, status: j.s, title: "" }),
    });

    expect(res.jobs[0]).toEqual({
      jobId: "a",
      status: "ok",
      title: "",
      updatedAt: null,
    });
  });
});
