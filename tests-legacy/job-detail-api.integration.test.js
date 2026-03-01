/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { startServer } from "../src/ui/server.js";
import * as testUtils from "./test-utils.js";

describe("Job Detail API Integration Tests", () => {
  let server;
  let tempDir;
  let jobId;

  beforeEach(async () => {
    // Create a temporary directory for test data
    tempDir = await testUtils.createTempDir();

    // Set up test environment
    process.env.PO_ROOT = tempDir;
    process.env.NODE_ENV = "test";

    // Create pipeline registry for token cost calculation
    const registryDir = path.join(tempDir, "pipeline-config");
    await fs.mkdir(registryDir, { recursive: true });
    const registry = {
      pipelines: {
        "test-pipeline": {
          name: "Test Pipeline",
          description: "Test pipeline for integration tests",
          tasks: ["task-1", "task-2"],
        },
      },
    };
    await fs.writeFile(
      path.join(registryDir, "registry.json"),
      JSON.stringify(registry, null, 2)
    );

    // Create test job data
    jobId = "testJob123";
    const jobDir = path.join(tempDir, "pipeline-data", "current", jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Create tasks-status.json (this is what the job reader expects)
    const tasksStatus = {
      id: jobId,
      name: "Test Job",
      createdAt: new Date().toISOString(),
      files: {
        artifacts: ["job-a1.json"],
        logs: ["job.log"],
        tmp: ["tmp-1.txt"],
      },
      tasks: {
        "task-1": {
          state: "done",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          tokenUsage: [["openai:gpt-5-mini", 1000, 500]],
          files: {
            artifacts: ["output.json"],
            logs: ["process.log"],
            tmp: ["temp.txt"],
          },
        },
        "task-2": {
          state: "done",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          tokenUsage: [["deepseek:chat", 2000, 300]],
          files: {
            artifacts: [],
            logs: [],
            tmp: [],
          },
        },
      },
    };
    await fs.writeFile(
      path.join(jobDir, "tasks-status.json"),
      JSON.stringify(tasksStatus, null, 2)
    );

    // Create pipeline snapshot
    const pipelineSnapshot = {
      name: "test-pipeline",
      tasks: ["task-1", "task-2"],
    };
    await fs.writeFile(
      path.join(jobDir, "pipeline.json"),
      JSON.stringify(pipelineSnapshot, null, 2)
    );

    // Start server
    server = await startServer({ dataDir: tempDir, port: 0 });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    delete process.env.PO_ROOT;
    delete process.env.NODE_ENV;
  });

  it("returns job detail with correct API envelope structure", async () => {
    const response = await fetch(`${server.url}/api/jobs/${jobId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const result = await response.json();

    // Verify envelope structure
    expect(result).toHaveProperty("ok", true);
    expect(result).toHaveProperty("data");
    expect(result.data).toHaveProperty("id", jobId);
    expect(result.data).toHaveProperty("name", "Test Job");
    expect(result.data).toHaveProperty("status", "complete");
    expect(result.data).toHaveProperty("pipeline");
    expect(result.data.pipeline).toHaveProperty("tasks", ["task-1", "task-2"]);
  });

  it("returns job detail with new files.* schema instead of legacy artifacts", async () => {
    const response = await fetch(`${server.url}/api/jobs/${jobId}`);

    expect(response.status).toBe(200);
    const result = await response.json();

    // Verify job-level files exist
    expect(result.data).toHaveProperty("files");
    expect(result.data.files).toHaveProperty("artifacts", ["job-a1.json"]);
    expect(result.data.files).toHaveProperty("logs", ["job.log"]);
    expect(result.data.files).toHaveProperty("tmp", ["tmp-1.txt"]);

    // Verify new files.* schema is present for tasks
    expect(result.data.tasks).toHaveLength(2);

    const task1 = result.data.tasks.find((t) => t.name === "task-1");
    expect(task1).toBeDefined();
    expect(task1).toHaveProperty("files");
    expect(task1.files).toHaveProperty("artifacts", ["output.json"]);
    expect(task1.files).toHaveProperty("logs", ["process.log"]);
    expect(task1.files).toHaveProperty("tmp", ["temp.txt"]);

    const task2 = result.data.tasks.find((t) => t.name === "task-2");
    expect(task2).toBeDefined();
    expect(task2).toHaveProperty("files");
    expect(task2.files).toHaveProperty("artifacts", []);
    expect(task2.files).toHaveProperty("logs", []);
    expect(task2.files).toHaveProperty("tmp", []);

    // Verify legacy artifacts field is NOT present
    expect(task1).not.toHaveProperty("artifacts");
    expect(task2).not.toHaveProperty("artifacts");

    // Verify legacy top-level artifacts is NOT present
    expect(result.data).not.toHaveProperty("artifacts");
  });

  it("returns 404 with proper envelope for non-existent job", async () => {
    const response = await fetch(`${server.url}/api/jobs/nonexistent-job`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");

    const result = await response.json();

    // Verify error envelope structure
    expect(result).toHaveProperty("ok", false);
    expect(result).toHaveProperty("code", "job_not_found");
    expect(result).toHaveProperty("message");
    expect(result).toHaveProperty("path", "nonexistent-job");
  });

  it("returns 400 with proper envelope for invalid job ID format", async () => {
    const response = await fetch(`${server.url}/api/jobs/invalid@id`);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");

    const result = await response.json();

    // Verify error envelope structure
    expect(result).toHaveProperty("ok", false);
    expect(result).toHaveProperty("code", "bad_request");
    expect(result).toHaveProperty("message");
    expect(result).toHaveProperty("path", "invalid@id");
  });

  it("returns non-zero costs when tasks have tokenUsage", async () => {
    const response = await fetch(`${server.url}/api/jobs/${jobId}`);

    expect(response.status).toBe(200);
    const result = await response.json();

    // Verify costs structure exists and has non-zero totals
    expect(result.data).toHaveProperty("costs");
    expect(result.data.costs).toHaveProperty("summary");
    expect(result.data.costs.summary).toHaveProperty("totalTokens");
    expect(result.data.costs.summary.totalTokens).toBeGreaterThan(0);
    expect(result.data.costs.summary.totalInputTokens).toBeGreaterThan(0);
    expect(result.data.costs.summary.totalOutputTokens).toBeGreaterThan(0);

    // Verify modelBreakdown uses real model keys, not 'null'
    expect(result.data.costs).toHaveProperty("modelBreakdown");
    expect(result.data.costs.modelBreakdown).not.toHaveProperty("null");
    expect(Object.keys(result.data.costs.modelBreakdown)).toEqual(
      expect.arrayContaining(["openai:gpt-5-mini", "deepseek:chat"])
    );

    // Verify taskBreakdown reflects per-task totals
    expect(result.data.costs).toHaveProperty("taskBreakdown");
    expect(result.data.costs.taskBreakdown).toHaveProperty("task-1");
    expect(result.data.costs.taskBreakdown).toHaveProperty("task-2");
    expect(result.data.costs.taskBreakdown["task-1"].summary.totalTokens).toBe(
      1500
    ); // 1000 + 500
    expect(result.data.costs.taskBreakdown["task-2"].summary.totalTokens).toBe(
      2300
    ); // 2000 + 300
  });

  it("maintains API contract consistency across successful and error responses", async () => {
    // Test successful response
    const successResponse = await fetch(`${server.url}/api/jobs/${jobId}`);
    const successResult = await successResponse.json();

    expect(successResult).toHaveProperty("ok");
    expect(successResult).toHaveProperty("data");
    expect(typeof successResult.ok).toBe("boolean");

    // Test error response
    const errorResponse = await fetch(`${server.url}/api/jobs/nonexistent`);
    const errorResult = await errorResponse.json();

    expect(errorResult).toHaveProperty("ok");
    expect(typeof errorResult.ok).toBe("boolean");
    expect(errorResult.ok).toBe(false);
    expect(errorResult).toHaveProperty("code");
    expect(errorResult).toHaveProperty("message");
  });
});
