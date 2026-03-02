import { describe, expect, it } from "vitest";

import type {
  AllowedActions,
  AnalysisProgressState,
  ApiError,
  ConnectionStatus,
  NormalizedJobSummary,
  SseEventType,
} from "../types";

describe("ui client types", () => {
  it("supports the shared type contracts", () => {
    const error = {
      code: "job_not_found",
      message: "Missing job",
      status: 404,
    } satisfies ApiError;

    const job = {
      id: "job-1",
      jobId: "job-1",
      name: "Example",
      status: "running",
      progress: 50,
      taskCount: 2,
      doneCount: 1,
      location: "current",
      tasks: {
        build: {
          name: "build",
          state: "running",
          startedAt: null,
          endedAt: null,
          files: { artifacts: [], logs: [], tmp: [] },
        },
      },
      displayCategory: "current",
    } satisfies NormalizedJobSummary;

    const analysis = {
      status: "idle",
      pipelineSlug: null,
      totalTasks: 0,
      completedTasks: 0,
      totalArtifacts: 0,
      completedArtifacts: 0,
      currentTask: null,
      currentArtifact: null,
      error: null,
    } satisfies AnalysisProgressState;

    const connection: ConnectionStatus = "connected";
    const event: SseEventType = "job:updated";
    const actions = { start: true, restart: false } satisfies AllowedActions;

    expect(error.status).toBe(404);
    expect(job.jobId).toBe("job-1");
    expect(analysis.status).toBe("idle");
    expect(connection).toBe("connected");
    expect(event).toBe("job:updated");
    expect(actions.start).toBe(true);
  });
});
