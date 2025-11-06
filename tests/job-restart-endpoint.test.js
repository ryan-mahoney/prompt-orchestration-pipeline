import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startServer } from "../src/ui/server.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getJobDirectoryPath } from "../src/config/paths.js";

describe("Job Restart Endpoint", () => {
  let server;
  let dataDir;
  let baseUrl;

  beforeEach(async () => {
    // Create a temporary directory for test data
    dataDir = `/tmp/job-restart-test-${Date.now()}`;
    await fs.mkdir(dataDir, { recursive: true });

    // Create pipeline-data structure
    const pipelineDataDir = path.join(dataDir, "pipeline-data");
    await fs.mkdir(path.join(pipelineDataDir, "current"), { recursive: true });
    await fs.mkdir(path.join(pipelineDataDir, "pending"), { recursive: true });
    await fs.mkdir(path.join(pipelineDataDir, "complete"), { recursive: true });
    await fs.mkdir(path.join(pipelineDataDir, "rejected"), { recursive: true });

    // Start server
    const serverInfo = await startServer({ dataDir });
    server = serverInfo;
    baseUrl = serverInfo.url;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    // Clean up temp directory
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should return 404 for non-existent job", async () => {
    const response = await fetch(
      `${baseUrl}/api/jobs/non-existent-job/restart`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      code: "job_not_found",
      message: "Job not found",
    });
  });

  it("should return 409 for job not in current lifecycle", async () => {
    // Create a job in complete lifecycle
    const jobId = "complete-job-123";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "complete");
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "completed",
        current: null,
        currentStage: null,
        lastUpdated: new Date().toISOString(),
        tasks: {},
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      code: "unsupported_lifecycle",
      message: "Job restart is only supported for jobs in 'current' lifecycle",
    });
  });

  it("should return 409 for running job", async () => {
    // Create a job in current lifecycle that is running
    const jobId = "running-job-456";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json with running state
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "running",
        current: "task-1",
        currentStage: "processing",
        lastUpdated: new Date().toISOString(),
        tasks: {},
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      code: "job_running",
      message: "Job is currently running",
    });
  });

  it("should allow restart for failed job with non-null current pointer", async () => {
    // Create a job in current lifecycle that failed but has a non-null current pointer
    const jobId = "failed-with-current-999";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json with failed state but current still set to a task
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "failed",
        current: "analysis", // non-null current pointer
        currentStage: "inference",
        lastUpdated: new Date().toISOString(),
        tasks: {
          research: {
            state: "done",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 100 }],
          },
          analysis: {
            state: "failed",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 50 }],
            error: { message: "ReferenceError: Exception is not defined" },
          },
        },
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      jobId,
      mode: "clean-slate",
      spawned: true,
    });

    // Verify the status was reset
    const updatedStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
    expect(updatedStatus.state).toBe("pending");
    expect(updatedStatus.current).toBe(null);
    expect(updatedStatus.currentStage).toBe(null);
    expect(updatedStatus.progress).toBe(0);

    // Verify tasks were reset
    expect(updatedStatus.tasks.research.state).toBe("pending");
    expect(updatedStatus.tasks.research.attempts).toBe(0);
    expect(updatedStatus.tasks.research.refinementAttempts).toBe(0);
    expect(updatedStatus.tasks.research.tokenUsage).toEqual([]);

    expect(updatedStatus.tasks.analysis.state).toBe("pending");
    expect(updatedStatus.tasks.analysis.attempts).toBe(0);
    expect(updatedStatus.tasks.analysis.refinementAttempts).toBe(0);
    expect(updatedStatus.tasks.analysis.tokenUsage).toEqual([]);
    expect(updatedStatus.tasks.analysis.error).toBeUndefined();
  });

  it("should successfully restart a completed job", async () => {
    // Create a job in current lifecycle that is completed
    const jobId = "completed-job-789";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json with completed state
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "completed",
        current: null,
        currentStage: null,
        lastUpdated: new Date().toISOString(),
        tasks: {
          "task-1": {
            state: "completed",
            attempts: 3,
            refinementAttempts: 1,
            tokenUsage: [{ model: "test", tokens: 100 }],
            failedStage: "error-stage",
            error: "Some error occurred",
          },
          "task-2": {
            state: "failed",
            attempts: 2,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 50 }],
          },
        },
        files: { artifacts: ["file1.txt"], logs: ["log1.txt"], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      jobId,
      mode: "clean-slate",
      spawned: true,
    });

    // Verify the status was reset
    const updatedStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
    expect(updatedStatus.state).toBe("pending");
    expect(updatedStatus.current).toBe(null);
    expect(updatedStatus.currentStage).toBe(null);
    expect(updatedStatus.progress).toBe(0);

    // Verify tasks were reset
    expect(updatedStatus.tasks["task-1"].state).toBe("pending");
    expect(updatedStatus.tasks["task-1"].currentStage).toBe(null);
    expect(updatedStatus.tasks["task-1"].attempts).toBe(0);
    expect(updatedStatus.tasks["task-1"].refinementAttempts).toBe(0);
    expect(updatedStatus.tasks["task-1"].tokenUsage).toEqual([]);
    expect(updatedStatus.tasks["task-1"].failedStage).toBeUndefined();
    expect(updatedStatus.tasks["task-1"].error).toBeUndefined();

    expect(updatedStatus.tasks["task-2"].state).toBe("pending");
    expect(updatedStatus.tasks["task-2"].currentStage).toBe(null);
    expect(updatedStatus.tasks["task-2"].attempts).toBe(0);
    expect(updatedStatus.tasks["task-2"].refinementAttempts).toBe(0);
    expect(updatedStatus.tasks["task-2"].tokenUsage).toEqual([]);

    // Verify files were preserved
    expect(updatedStatus.files.artifacts).toEqual(["file1.txt"]);
    expect(updatedStatus.files.logs).toEqual(["log1.txt"]);
    expect(updatedStatus.files.tmp).toEqual([]);
  });
});
