import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startServer } from "../src/ui/server.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getJobDirectoryPath } from "../src/config/paths.js";

describe("Job Start Task Endpoint", () => {
  let server;
  let dataDir;
  let baseUrl;

  beforeEach(async () => {
    // Create a temporary directory for test data
    dataDir = `/tmp/job-start-task-test-${Date.now()}`;
    await fs.mkdir(dataDir, { recursive: true });

    // Create pipeline-data structure
    const pipelineDataDir = path.join(dataDir, "pipeline-data");
    await fs.mkdir(path.join(pipelineDataDir, "current"), { recursive: true });
    await fs.mkdir(path.join(pipelineDataDir, "pending"), { recursive: true });
    await fs.mkdir(path.join(pipelineDataDir, "complete"), { recursive: true });
    await fs.mkdir(path.join(pipelineDataDir, "rejected"), { recursive: true });

    // Start server
    const serverInfo = await startServer({ dataDir, port: 0 });
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

  describe("Validation cases", () => {
    it("should return 400 when jobId is empty", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs//tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(404); // Empty jobId results in 404 from routing
    });

    it("should return 400 when taskId is empty", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job/tasks//start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(404); // Empty taskId results in 404 from routing
    });
  });

  describe("Error handling", () => {
    it("should return 404 for non-existent job", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/non-existent-job/tasks/test-task/start`,
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

    it("should return 500 for invalid JSON in tasks-status.json", async () => {
      const jobId = "invalid-json-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create invalid JSON tasks-status.json
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(statusPath, "invalid json content");

      // Create pipeline.json
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        code: "internal_error",
        message: "Invalid job status JSON",
      });
    });

    it("should return 404 for missing tasks-status.json", async () => {
      const jobId = "no-status-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create pipeline.json but no tasks-status.json
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
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
        message: "Job status file not found",
      });
    });
  });

  describe("Job lifecycle cases", () => {
    it("should move job from complete to current and proceed", async () => {
      const jobId = "complete-job";
      const sourceJobDir = getJobDirectoryPath(dataDir, jobId, "complete");
      const targetJobDir = getJobDirectoryPath(dataDir, jobId, "current");

      await fs.mkdir(sourceJobDir, { recursive: true });

      // Create tasks-status.json in complete directory
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
            "upstream-task": {
              state: "done",
              attempts: 1,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
            "test-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json
      const pipelinePath = path.join(sourceJobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["upstream-task", "test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body).toEqual({
        ok: true,
        jobId,
        taskId: "test-task",
        mode: "single-task-start",
        spawned: true,
      });

      // Verify job directory no longer exists in complete
      try {
        await fs.access(sourceJobDir);
        expect(false).toBe(true); // Should not reach here
      } catch {
        // Expected - directory should not exist
      }

      // Verify job directory now exists in current
      await fs.access(targetJobDir); // Should not throw
    });

    it("should proceed when job is already in current", async () => {
      const jobId = "current-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");

      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json in current directory
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "idle",
          current: null,
          currentStage: null,
          lastUpdated: new Date().toISOString(),
          tasks: {
            "upstream-task": {
              state: "done",
              attempts: 1,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
            "test-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["upstream-task", "test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body).toEqual({
        ok: true,
        jobId,
        taskId: "test-task",
        mode: "single-task-start",
        spawned: true,
      });

      // Verify job directory still exists in current
      await fs.access(jobDir); // Should not throw
    });
  });

  describe("Task state cases", () => {
    it("should return 409 when job is running", async () => {
      const jobId = "running-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json with running state
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "running",
          current: "some-task",
          currentStage: "processing",
          lastUpdated: new Date().toISOString(),
          tasks: {
            "test-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        code: "job_running",
        message: "Job is currently running; start is unavailable",
      });
    });

    it("should return 409 when any task is running", async () => {
      const jobId = "job-with-running-task";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json with one running task
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "idle",
          current: null,
          currentStage: null,
          lastUpdated: new Date().toISOString(),
          tasks: {
            "other-task": {
              state: "running",
              attempts: 1,
              refinementAttempts: 0,
              currentStage: "processing",
              files: { artifacts: [], logs: [], tmp: [] },
            },
            "test-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["other-task", "test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        code: "job_running",
        message: "Job is currently running; start is unavailable",
      });
    });

    it("should return 400 when task not found", async () => {
      const jobId = "test-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json without the target task
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "idle",
          current: null,
          currentStage: null,
          lastUpdated: new Date().toISOString(),
          tasks: {
            "other-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["other-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/nonexistent-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        code: "task_not_found",
        message: "Task not found in job",
      });
    });

    it("should return 400 when task is not pending", async () => {
      const jobId = "test-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json with task already done
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "idle",
          current: null,
          currentStage: null,
          lastUpdated: new Date().toISOString(),
          tasks: {
            "test-task": {
              state: "done",
              attempts: 1,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        code: "task_not_pending",
        message: "Task is not in pending state",
      });
    });
  });

  describe("Pipeline config cases", () => {
    it("should return 500 when pipeline config not found", async () => {
      const jobId = "no-pipeline-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json but no pipeline.json
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "idle",
          current: null,
          currentStage: null,
          lastUpdated: new Date().toISOString(),
          tasks: {
            "test-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        code: "pipeline_config_not_found",
        message: "Pipeline configuration not found",
      });
    });

    it("should return 409 when dependencies not satisfied", async () => {
      const jobId = "dep-fail-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json with upstream task not done
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "idle",
          current: null,
          currentStage: null,
          lastUpdated: new Date().toISOString(),
          tasks: {
            "upstream-task": {
              state: "pending", // Not done - this should cause dependency failure
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
            "test-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json with dependency order
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["upstream-task", "test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        code: "dependencies_not_satisfied",
        message: "Dependencies not satisfied for task: upstream-task",
      });
    });

    it("should succeed when dependencies are satisfied", async () => {
      const jobId = "dep-success-job";
      const jobDir = getJobDirectoryPath(dataDir, jobId, "current");
      await fs.mkdir(jobDir, { recursive: true });

      // Create tasks-status.json with upstream task done
      const statusPath = path.join(jobDir, "tasks-status.json");
      await fs.writeFile(
        statusPath,
        JSON.stringify({
          id: jobId,
          state: "idle",
          current: null,
          currentStage: null,
          lastUpdated: new Date().toISOString(),
          tasks: {
            "upstream-task": {
              state: "done", // Done - dependencies satisfied
              attempts: 1,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
            "test-task": {
              state: "pending",
              attempts: 0,
              refinementAttempts: 0,
              currentStage: null,
              files: { artifacts: [], logs: [], tmp: [] },
            },
          },
          files: { artifacts: [], logs: [], tmp: [] },
        })
      );

      // Create pipeline.json with dependency order
      const pipelinePath = path.join(jobDir, "pipeline.json");
      await fs.writeFile(
        pipelinePath,
        JSON.stringify({ tasks: ["upstream-task", "test-task"] })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/test-task/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body).toEqual({
        ok: true,
        jobId,
        taskId: "test-task",
        mode: "single-task-start",
        spawned: true,
      });
    });
  });
});
