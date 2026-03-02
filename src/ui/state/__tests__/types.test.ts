import { describe, expect, it } from "vitest";

import type {
  APIJob,
  AcquireResult,
  CanonicalJob,
  ChangeTrackerState,
  ComposeSnapshotOptions,
  FilterOptions,
  GroupedJobs,
  SchemaContext,
  SSEStreamResult,
  SnapshotDeps,
  TransformationStats,
  WatcherHandle,
  WatcherOptions,
} from "../types";

describe("ui/state types", () => {
  it("supports the expected public shapes", () => {
    const state: ChangeTrackerState = {
      updatedAt: new Date().toISOString(),
      changeCount: 0,
      recentChanges: [],
      watchedPaths: [],
    };

    const acquire: AcquireResult = { acquired: true };
    const watcherOptions: WatcherOptions = { baseDir: "/tmp" };
    const watcherHandle: WatcherHandle = { close: async () => {} };
    const snapshotOptions: ComposeSnapshotOptions = { jobs: [], meta: "1.0.0" };
    const snapshotDeps: SnapshotDeps = {};
    const schema: SchemaContext = {
      fileName: "seed.json",
      schema: {},
      sample: {},
    };
    const result: SSEStreamResult = {
      response: new Response(""),
      writer: { send: () => {}, close: () => {} },
    };
    const job: CanonicalJob = {
      id: "job-1",
      jobId: "job-1",
      name: "Job 1",
      title: "Job 1",
      status: "pending",
      progress: 0,
      createdAt: null,
      updatedAt: null,
      location: "current",
      tasks: {},
      files: {},
      costs: {},
    };
    const grouped: GroupedJobs = {
      running: [],
      error: [],
      pending: [job],
      complete: [],
    };
    const filter: FilterOptions = { status: "pending", location: "current" };
    const apiJob: APIJob = {
      jobId: "job-1",
      title: "Job 1",
      status: "pending",
      progress: 0,
      createdAt: null,
      updatedAt: null,
      location: "current",
      tasks: {},
      costsSummary: {
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        totalInputCost: 0,
        totalOutputCost: 0,
      },
    };
    const stats: TransformationStats = {
      totalRead: 0,
      successfulReads: 0,
      successfulTransforms: 0,
      failedTransforms: 0,
      transformationRate: 0,
      statusDistribution: {},
    };

    expect(state.changeCount).toBe(0);
    expect(acquire.acquired).toBe(true);
    expect(watcherOptions.baseDir).toBe("/tmp");
    expect(typeof watcherHandle.close).toBe("function");
    expect(snapshotOptions.meta).toBe("1.0.0");
    expect(snapshotDeps.readJob).toBeUndefined();
    expect(schema.fileName).toBe("seed.json");
    expect(result.response).toBeInstanceOf(Response);
    expect(grouped.pending[0]).toBe(job);
    expect(filter.location).toBe("current");
    expect(apiJob.costsSummary.totalCost).toBe(0);
    expect(stats.transformationRate).toBe(0);
  });
});
