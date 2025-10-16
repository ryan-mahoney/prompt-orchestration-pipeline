/**
 * Integration tests for job task file endpoint
 * @module tests/job-file-endpoint.integration.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { startServer } from "../src/ui/server.js";
import { createTempDir, cleanupTempDir } from "./test-utils.js";

describe("Job Task File Endpoint Integration", () => {
  let server;
  let tempDir;
  let baseUrl;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temporary directory structure
    tempDir = await createTempDir();

    // Create pipeline data structure
    const currentDir = path.join(tempDir, "pipeline-data", "current");
    const completeDir = path.join(tempDir, "pipeline-data", "complete");
    await fs.mkdir(currentDir, { recursive: true });
    await fs.mkdir(completeDir, { recursive: true });

    // Create test job structure
    const jobId = "test-job-123";
    const taskId = "analysis";

    // Create job directories in current
    const currentJobDir = path.join(currentDir, jobId, "tasks", taskId);
    await fs.mkdir(path.join(currentJobDir, "artifacts"), { recursive: true });
    await fs.mkdir(path.join(currentJobDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(currentJobDir, "tmp"), { recursive: true });

    // Create test files
    await fs.writeFile(
      path.join(currentJobDir, "artifacts", "output.json"),
      JSON.stringify({ result: "success", data: [1, 2, 3] }, null, 2)
    );

    await fs.writeFile(
      path.join(currentJobDir, "logs", "test.log"),
      "2024-01-01 10:00:00 INFO Starting analysis\n2024-01-01 10:00:05 INFO Analysis complete"
    );

    await fs.writeFile(
      path.join(currentJobDir, "tmp", "blob.bin"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // PNG header
    );

    // Create job metadata
    await fs.writeFile(
      path.join(currentDir, jobId, "metadata.json"),
      JSON.stringify({
        id: jobId,
        name: "Test Job",
        status: "running",
        createdAt: new Date().toISOString(),
      })
    );

    // Start server with temporary directory
    const serverInstance = await startServer({
      dataDir: tempDir,
      port: 0, // Use ephemeral port
    });

    server = serverInstance;
    baseUrl = serverInstance.url;
  });

  afterEach(async () => {
    // Close server
    if (server && typeof server.close === "function") {
      await server.close();
    }

    // Clean up temporary directory
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }

    vi.restoreAllMocks();
  });

  describe("GET /api/jobs/:jobId/tasks/:taskId/file", () => {
    it("should return 200 for artifacts JSON file with correct structure", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=output.json`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");

      const data = await response.json();
      expect(data).toEqual({
        ok: true,
        jobId: "test-job-123",
        taskId: "analysis",
        type: "artifacts",
        path: "tasks/analysis/artifacts/output.json",
        mime: "application/json",
        size: expect.any(Number),
        mtime: expect.any(String),
        encoding: "utf8",
        content: expect.stringContaining('"result": "success"'),
      });
    });

    it("should return 200 for logs text file with correct structure", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=logs&filename=test.log`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");

      const data = await response.json();
      expect(data).toEqual({
        ok: true,
        jobId: "test-job-123",
        taskId: "analysis",
        type: "logs",
        path: "tasks/analysis/logs/test.log",
        mime: "text/plain",
        size: expect.any(Number),
        mtime: expect.any(String),
        encoding: "utf8",
        content:
          "2024-01-01 10:00:00 INFO Starting analysis\n2024-01-01 10:00:05 INFO Analysis complete",
      });
    });

    it("should return 200 for binary file with base64 encoding", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=tmp&filename=blob.bin`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");

      const data = await response.json();
      expect(data).toEqual({
        ok: true,
        jobId: "test-job-123",
        taskId: "analysis",
        type: "tmp",
        path: "tasks/analysis/tmp/blob.bin",
        mime: "application/octet-stream",
        size: expect.any(Number),
        mtime: expect.any(String),
        encoding: "base64",
        content: "iVBORw0KGgo=",
      });
    });

    it("should return 400 for missing type parameter", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?filename=output.json`
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "bad_request",
        message: expect.stringContaining("type"),
      });
    });

    it("should return 400 for missing filename parameter", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts`
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "bad_request",
        message: expect.stringContaining("filename"),
      });
    });

    it("should return 400 for invalid type parameter", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=invalid&filename=test.txt`
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "bad_request",
        message: expect.stringContaining("type"),
      });
    });

    it("should return 400 for empty filename parameter", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=`
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "bad_request",
        message: expect.stringContaining("filename"),
      });
    });

    it("should return 403 for path traversal attempt", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=../../../etc/passwd`
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "forbidden",
        message: "Path traversal not allowed",
      });
    });

    it("should return 403 for absolute path attempt", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=/etc/passwd`
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "forbidden",
        message: "Absolute paths not allowed",
      });
    });

    it("should return 403 for Windows drive letter attempt", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=C:\\Windows\\System32\\config`
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "forbidden",
        message: "Absolute paths not allowed",
      });
    });

    it("should return 404 for non-existent job", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/non-existent-job/tasks/analysis/file?type=artifacts&filename=output.json`
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "not_found",
        message: expect.stringContaining("not found"),
      });
    });

    it("should return 404 for non-existent task", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/non-existent-task/file?type=artifacts&filename=output.json`
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "not_found",
        message: expect.stringContaining("not found"),
      });
    });

    it("should return 404 for non-existent file", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=non-existent.json`
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "not_found",
        message: expect.stringContaining("not found"),
      });
    });

    it("should fallback to complete directory when not found in current", async () => {
      // Create job structure in complete directory
      const jobId = "complete-job-456";
      const taskId = "analysis";

      const completeDir = path.join(tempDir, "pipeline-data", "complete");
      const completeJobDir = path.join(completeDir, jobId, "tasks", taskId);
      await fs.mkdir(path.join(completeJobDir, "artifacts"), {
        recursive: true,
      });

      await fs.writeFile(
        path.join(completeJobDir, "artifacts", "complete-output.json"),
        JSON.stringify({ result: "complete", data: [4, 5, 6] }, null, 2)
      );

      await fs.writeFile(
        path.join(completeDir, jobId, "metadata.json"),
        JSON.stringify({
          id: jobId,
          name: "Complete Job",
          status: "completed",
          createdAt: new Date().toISOString(),
        })
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/complete-job-456/tasks/analysis/file?type=artifacts&filename=complete-output.json`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.jobId).toBe("complete-job-456");
      expect(data.content).toContain('"result": "complete"');
    });

    it("should return 404 when file not found in both current and complete", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=missing-file.json`
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        ok: false,
        error: "not_found",
        message: expect.stringContaining("not found"),
      });
    });

    it("should handle nested directory paths correctly", async () => {
      // Create nested directory structure
      const nestedDir = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "test-job-123",
        "tasks",
        "analysis",
        "artifacts",
        "subdir"
      );
      await fs.mkdir(nestedDir, { recursive: true });

      await fs.writeFile(
        path.join(nestedDir, "nested.json"),
        JSON.stringify({ nested: true }, null, 2)
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=subdir/nested.json`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.path).toBe("tasks/analysis/artifacts/subdir/nested.json");
      expect(data.content).toContain('"nested": true');
    });

    it("should reject path traversal that resolves outside jail", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=subdir/../../../../../etc/passwd`
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("forbidden");
    });

    it("should allow path traversal that stays within jail", async () => {
      // Create nested directory with traversal that stays within bounds
      const nestedDir = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "test-job-123",
        "tasks",
        "analysis",
        "artifacts",
        "subdir",
        "inner"
      );
      await fs.mkdir(nestedDir, { recursive: true });

      await fs.writeFile(
        path.join(nestedDir, "safe.json"),
        JSON.stringify({ safe: true }, null, 2)
      );

      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=subdir/inner/./safe.json`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.content).toContain('"safe": true');
    });
  });

  describe("MIME type detection", () => {
    beforeEach(async () => {
      // Create additional test files for MIME type testing
      const currentJobDir = path.join(
        tempDir,
        "pipeline-data",
        "current",
        "test-job-123",
        "tasks",
        "analysis"
      );

      await fs.mkdir(path.join(currentJobDir, "artifacts"), {
        recursive: true,
      });
      await fs.mkdir(path.join(currentJobDir, "logs"), { recursive: true });

      // Create files with different extensions
      await fs.writeFile(
        path.join(currentJobDir, "artifacts", "report.txt"),
        "This is a plain text report"
      );

      await fs.writeFile(
        path.join(currentJobDir, "artifacts", "data.csv"),
        "name,value\ntest,123"
      );

      await fs.writeFile(
        path.join(currentJobDir, "artifacts", "config.xml"),
        '<?xml version="1.0"?><config></config>'
      );

      await fs.writeFile(
        path.join(currentJobDir, "artifacts", "script.js"),
        "console.log('hello');"
      );

      await fs.writeFile(
        path.join(currentJobDir, "artifacts", "unknown"),
        Buffer.from([0x01, 0x02, 0x03, 0x04])
      );
    });

    it("should detect text/plain for .txt files", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=report.txt`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.mime).toBe("text/plain");
      expect(data.encoding).toBe("utf8");
    });

    it("should detect text/csv for .csv files", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=data.csv`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.mime).toBe("text/csv");
      expect(data.encoding).toBe("utf8");
    });

    it("should detect application/xml for .xml files", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=config.xml`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.mime).toBe("application/xml");
      expect(data.encoding).toBe("utf8");
    });

    it("should detect application/javascript for .js files", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=script.js`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.mime).toBe("application/javascript");
      expect(data.encoding).toBe("utf8");
    });

    it("should fallback to application/octet-stream for unknown extensions", async () => {
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job-123/tasks/analysis/file?type=artifacts&filename=unknown`
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.mime).toBe("application/octet-stream");
      expect(data.encoding).toBe("base64");
    });
  });
});
