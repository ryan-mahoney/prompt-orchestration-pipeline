import { describe, expect, it } from "vitest";

import {
  aggregateAndSortJobs,
  filterJobs,
  getAggregationStats,
  getJobListStats,
  getStatusPriority,
  groupJobsByStatus,
  sortJobs,
  transformJobListForAPI,
} from "../list-transformer";
import type { CanonicalJob } from "../../types";

function makeJob(overrides: Partial<CanonicalJob> = {}): CanonicalJob {
  return {
    id: "job-1",
    jobId: "job-1",
    name: "Job 1",
    title: "Job 1",
    status: "pending",
    progress: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: null,
    location: "current",
    tasks: {},
    files: {},
    costs: {},
    ...overrides,
  };
}

describe("list-transformer", () => {
  it("returns status priorities and sorts valid jobs only", () => {
    expect(getStatusPriority("running")).toBe(4);
    expect(getStatusPriority("unknown")).toBe(0);

    const jobs = sortJobs([
      makeJob({ id: "job-3", jobId: "job-3", status: "pending" }),
      makeJob({ id: "job-2", jobId: "job-2", status: "running" }),
      makeJob({ id: "job-1", jobId: "job-1", status: "complete", createdAt: null }),
    ]);

    expect(jobs.map((job) => job.id)).toEqual(["job-2", "job-3"]);
  });

  it("deduplicates with current wins and tolerates internal errors", () => {
    const current = [makeJob({ id: "job-1", title: "Current" })];
    const complete = [makeJob({ id: "job-1", title: "Complete", location: "complete" })];

    expect(aggregateAndSortJobs(current, complete)[0]?.title).toBe("Current");
    expect(aggregateAndSortJobs(null as unknown as CanonicalJob[], complete)).toEqual([]);
  });

  it("groups, filters, and summarizes jobs", () => {
    const jobs = [
      makeJob({ id: "job-1", title: "Alpha", status: "running", progress: 50 }),
      makeJob({ id: "job-2", jobId: "job-2", title: "Beta", status: "complete", progress: 100, location: "complete" }),
    ];

    expect(groupJobsByStatus(jobs)).toMatchObject({
      running: [jobs[0]],
      complete: [jobs[1]],
    });
    expect(getJobListStats(jobs).averageProgress).toBe(75);
    expect(filterJobs(jobs, "alp")).toEqual([jobs[0]]);
    expect(filterJobs(jobs, "JOB-2")).toEqual([jobs[1]]);
    expect(filterJobs(jobs, "", { status: "complete", location: "complete" })).toEqual([jobs[1]]);
  });

  it("always includes zeroed costs in API output and computes aggregation stats", () => {
    const jobs = [makeJob()];

    expect(transformJobListForAPI(jobs)[0]?.costsSummary).toEqual({
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      totalInputCost: 0,
      totalOutputCost: 0,
    });
    expect(getAggregationStats(jobs, jobs, jobs)).toEqual({
      totalInput: 2,
      totalOutput: 1,
      duplicates: 1,
      efficiency: 0.5,
      statusDistribution: { pending: 1 },
      locationDistribution: { current: 1 },
    });
  });
});
