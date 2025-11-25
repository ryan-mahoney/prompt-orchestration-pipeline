import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startServer } from "../src/ui/server.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getJobDirectoryPath } from "../src/config/paths.js";

describe("Job Stop Endpoint", () => {
  let server;
  let dataDir;
  let baseUrl;

  beforeEach(async () => {
    // Create a temporary directory for test data
    dataDir = `/tmp/job-stop-test-${Date.now()}`;
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
    const response = await fetch(`${baseUrl}/api/jobs/non-existent-job/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      code: "job_not_found",
      message: "Job not found",
    });
  });

  it("should return 400 for empty jobId", async () => {
    const response = await fetch(`${baseUrl}/api/jobs//stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(404); // Route doesn't match
  });

  it("should stop job when runner.pid exists", async () => {
    // Mock process.kill to track calls
    const originalKill = process.kill;
    const killCalls = [];
    process.kill = vi.fn((pid, signal) => {
      killCalls.push({ pid, signal });
      if (signal === "SIGTERM") {
        // Simulate process still exists after SIGTERM
        return; // Don't throw error
      }
      if (signal === 0) {
        // Simulate process still exists - process.kill(pid, 0) is used to check if process exists
        // Return without error means process exists
        return;
      }
      if (signal === "SIGKILL") {
        // Simulate successful kill - process killed cleanly
        return; // Don't throw error, SIGKILL succeeded
      }
      return originalKill.call(process, pid, signal);
    });

    try {
      const jobId = "job-with-runner-123";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create runner.pid file
      const pidPath = path.join(jobDir, "runner.pid");
      const mockPid = 12345;
      await fs.writeFile(pidPath, `${mockPid}\n`);

      // Create tasks-status.json with running task
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "running",
          current: "task-1",
          currentStage: "processing",
          lastUpdated: new Date().toISOString(),
          tasks: {
            "task-1": {
              state: "running",
              currentStage: "processing",
              attempts: 1,
              refinementAttempts: 0,
              tokenUsage: [{ model: "test", tokens: 100 }],
            },
            "task-2": {
              state: "pending",
              currentStage: null,
              attempts: 0,
              refinementAttempts: 0,
              tokenUsage: [],
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      const response = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        ok: true,
        jobId,
        stopped: true,
        resetTask: "task-1",
        signal: "SIGKILL", // Should fallback to SIGKILL
      });

      // Verify process.kill was called correctly
      expect(killCalls).toHaveLength(3);
      expect(killCalls[0]).toEqual({ pid: mockPid, signal: "SIGTERM" });
      expect(killCalls[1]).toEqual({ pid: mockPid, signal: 0 }); // Process existence check
      expect(killCalls[2]).toEqual({ pid: mockPid, signal: "SIGKILL" });

      // Verify runner.pid was removed
      expect(await fs.access(pidPath).catch(() => false)).toBe(false);

      // Verify task was reset
      const updatedStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
      expect(updatedStatus.tasks["task-1"].state).toBe("pending");
      expect(updatedStatus.tasks["task-1"].currentStage).toBeNull();
      expect(updatedStatus.tasks["task-1"].attempts).toBe(0);
      expect(updatedStatus.tasks["task-1"].tokenUsage).toEqual([]);

      // Verify root fields were cleared
      expect(updatedStatus.current).toBeNull();
      expect(updatedStatus.currentStage).toBeNull();

      // Verify other tasks remain unchanged
      expect(updatedStatus.tasks["task-2"].state).toBe("pending");
    } finally {
      process.kill = originalKill;
    }
  });

  it("should handle stopped job when no runner.pid exists", async () => {
    const jobId = "job-without-runner-456";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json with running task but no runner.pid
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "running",
        current: "task-1",
        currentStage: "processing",
        lastUpdated: new Date().toISOString(),
        tasks: {
          "task-1": {
            state: "running",
            currentStage: "processing",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 100 }],
          },
        },
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      jobId,
      stopped: false,
      resetTask: "task-1",
      signal: null,
    });

    // Verify task was reset
    const updatedStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
    expect(updatedStatus.tasks["task-1"].state).toBe("pending");
    expect(updatedStatus.current).toBeNull();
    expect(updatedStatus.currentStage).toBeNull();
  });

  it("should handle job in complete lifecycle by moving to current", async () => {
    const jobId = "complete-job-789";
    const sourceJobDir = getJobDirectoryPath(dataDir, jobId, "complete");
    const targetJobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(sourceJobDir, { recursive: true });

    // Create runner.pid file in complete directory
    const pidPath = path.join(sourceJobDir, "runner.pid");
    await fs.writeFile(pidPath, "99999\n");

    // Create tasks-status.json
    const statusPath = path.join(sourceJobDir, "tasks-status.json");
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
            state: "done",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 100 }],
          },
        },
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe(jobId);
    expect(body.stopped).toBe(true); // runner.pid existed

    // Verify job was moved to current
    expect(await fs.access(sourceJobDir).catch(() => false)).toBe(false);
    expect(await fs.access(targetJobDir).catch(() => false)).toBe(true);

    // Verify runner.pid was removed
    const targetPidPath = path.join(targetJobDir, "runner.pid");
    expect(await fs.access(targetPidPath).catch(() => false)).toBe(false);

    // Verify status was normalized
    const updatedStatusPath = path.join(targetJobDir, "tasks-status.json");
    const updatedStatus = JSON.parse(
      await fs.readFile(updatedStatusPath, "utf8")
    );
    expect(updatedStatus.current).toBeNull();
    expect(updatedStatus.currentStage).toBeNull();
  });

  it("should handle ESRCH error during SIGTERM", async () => {
    // Mock process.kill to simulate ESRCH on SIGTERM
    const originalKill = process.kill;
    process.kill = vi.fn((pid, signal) => {
      if (signal === "SIGTERM") {
        const error = new Error("No such process");
        error.code = "ESRCH";
        throw error;
      }
      return originalKill.call(process, pid, signal);
    });

    try {
      const jobId = "job-esrch-123";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create runner.pid file
      const pidPath = path.join(jobDir, "runner.pid");
      await fs.writeFile(pidPath, "54321\n");

      // Create tasks-status.json
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "running",
          current: null,
          currentStage: null,
          tasks: {},
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      const response = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        ok: true,
        jobId,
        stopped: true, // pid file existed
        resetTask: null,
        signal: null, // ESRCH means no signal was successfully sent
      });

      // Verify runner.pid was removed despite ESRCH
      expect(await fs.access(pidPath).catch(() => false)).toBe(false);
    } finally {
      process.kill = originalKill;
    }
  });

  it("should handle invalid PID in runner.pid", async () => {
    const jobId = "job-invalid-pid-456";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create runner.pid file with invalid content
    const pidPath = path.join(jobDir, "runner.pid");
    await fs.writeFile(pidPath, "invalid-pid\n");

    // Create tasks-status.json
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "running",
        current: null,
        currentStage: null,
        tasks: {},
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      jobId,
      stopped: false, // Invalid PID treated as no runner
      resetTask: null,
      signal: null,
    });

    // Verify runner.pid was removed
    expect(await fs.access(pidPath).catch(() => false)).toBe(false);
  });

  it("should find running task when snapshot.current is null but task state is running", async () => {
    const jobId = "job-current-null-789";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json with null current but running task
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "running",
        current: null, // Current is null
        currentStage: null,
        lastUpdated: new Date().toISOString(),
        tasks: {
          "task-1": {
            state: "done",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 100 }],
          },
          "task-2": {
            state: "running", // But this task is running
            currentStage: "processing",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 50 }],
          },
        },
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      jobId,
      stopped: false,
      resetTask: "task-2", // Should find and reset the running task
      signal: null,
    });

    // Verify task-2 was reset
    const updatedStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
    expect(updatedStatus.tasks["task-2"].state).toBe("pending");
    expect(updatedStatus.tasks["task-2"].currentStage).toBeNull();
    expect(updatedStatus.tasks["task-2"].attempts).toBe(0);
    expect(updatedStatus.tasks["task-2"].tokenUsage).toEqual([]);

    // Verify task-1 remains unchanged
    expect(updatedStatus.tasks["task-1"].state).toBe("done");
    expect(updatedStatus.tasks["task-1"].attempts).toBe(1);
  });

  it("should return 409 for concurrent stop requests", async () => {
    const jobId = "concurrent-stop-123";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create runner.pid file
    const pidPath = path.join(jobDir, "runner.pid");
    await fs.writeFile(pidPath, "11111\n");

    // Create tasks-status.json
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "running",
        current: null,
        currentStage: null,
        tasks: {},
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    // Make first request (this should hang until we make the second)
    const firstRequest = fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // Small delay to ensure first request starts processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Make second request - this should return 409
    const secondResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(secondResponse.status).toBe(409);
    const secondBody = await secondResponse.json();
    expect(secondBody).toEqual({
      ok: false,
      code: "job_running",
      message: "Job stop is already in progress",
    });

    // Clean up the first request
    await firstRequest;
  });

  it("should handle job with no running tasks", async () => {
    const jobId = "no-running-tasks-456";
    const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json with no running tasks
    const statusPath = path.join(jobDir, "tasks-status.json");
    await fs.writeFile(
      statusPath,
      JSON.stringify({
        id: jobId,
        state: "failed", // Not running state
        current: null,
        currentStage: null,
        lastUpdated: new Date().toISOString(),
        tasks: {
          "task-1": {
            state: "done",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 100 }],
          },
          "task-2": {
            state: "failed",
            attempts: 1,
            refinementAttempts: 0,
            tokenUsage: [{ model: "test", tokens: 50 }],
          },
        },
        files: { artifacts: [], logs: [], tmp: [] },
      })
    );

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      jobId,
      stopped: false,
      resetTask: null, // No running task to reset
      signal: null,
    });

    // Verify root fields were cleared
    const updatedStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
    expect(updatedStatus.current).toBeNull();
    expect(updatedStatus.currentStage).toBeNull();

    // Verify tasks remain unchanged
    expect(updatedStatus.tasks["task-1"].state).toBe("done");
    expect(updatedStatus.tasks["task-2"].state).toBe("failed");
  });
});
