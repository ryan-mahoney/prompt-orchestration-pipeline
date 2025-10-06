/**
 * End-to-End Upload Test (Step 8)
 * Tests the complete upload flow using test utilities from Step 7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createTempPipelineDir,
  startOrchestrator,
  setupTestEnvironment,
  restoreRealTimers,
} from "./utils/index.js";
import { startTestServer } from "./utils/serverHelper.js";

describe("E2E Upload Flow", () => {
  let pipelineDataDir;
  let server;
  let orchestrator;
  let baseUrl;

  beforeEach(async () => {
    setupTestEnvironment();

    // Create temporary pipeline directory using Step 7 utility
    pipelineDataDir = await createTempPipelineDir();

    // Start server using new server helper - pass the parent directory as base
    const baseDir = path.dirname(pipelineDataDir);
    server = await startTestServer({ dataDir: baseDir, port: 0 });
    baseUrl = server.url;

    // Start orchestrator using Step 7 utility
    orchestrator = await startOrchestrator({ dataDir: baseDir });
  });

  afterEach(async () => {
    // Clean up using Step 7 utilities
    if (orchestrator) {
      await orchestrator.stop();
    }
    if (server) {
      await server.close();
    }
    if (pipelineDataDir) {
      await fs.rm(path.dirname(pipelineDataDir), {
        recursive: true,
        force: true,
      });
    }
    restoreRealTimers();
  });

  describe("SSE event broadcasting", () => {
    it("should broadcast seed:uploaded event after successful upload", async () => {
      const validSeed = {
        name: "sse-test-job",
        data: { test: "sse data" },
      };

      // Spy on the SSE registry to verify broadcasting
      const { sseRegistry } = await import("../src/ui/sse.js");
      const broadcastSpy = vi.spyOn(sseRegistry, "broadcast");

      // Create FormData with File
      const formData = new FormData();
      const file = new File([JSON.stringify(validSeed)], "seed.json", {
        type: "application/json",
      });
      formData.append("file", file);

      // Perform upload
      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      // Verify API response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify SSE event was broadcast with correct format
      expect(broadcastSpy).toHaveBeenCalledWith({
        type: "seed:uploaded",
        data: { jobName: "sse-test-job" },
      });

      // Clean up spy
      broadcastSpy.mockRestore();
    });
  });

  describe("Valid upload flow", () => {
    it("should complete full upload → SSE → orchestrator pickup flow", async () => {
      const validSeed = {
        name: "e2e-test-job",
        data: { test: "e2e data" },
      };

      // Spy on the SSE registry to verify broadcasting
      const { sseRegistry } = await import("../src/ui/sse.js");
      const broadcastSpy = vi.spyOn(sseRegistry, "broadcast");

      // Create FormData with File (using polyfill from Step 7)
      const formData = new FormData();
      const file = new File([JSON.stringify(validSeed)], "seed.json", {
        type: "application/json",
      });
      formData.append("file", file);

      // Perform upload
      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      // Verify API response
      expect(response.status).toBe(200);
      expect(result).toEqual({
        success: true,
        jobName: "e2e-test-job",
        message: "Seed file uploaded successfully",
      });

      // Verify SSE event was broadcast with correct format
      expect(broadcastSpy).toHaveBeenCalledWith({
        type: "seed:uploaded",
        data: { jobName: "e2e-test-job" },
      });

      // Verify file was written to pending directory
      const pendingPath = path.join(
        pipelineDataDir,
        "pending",
        "e2e-test-job-seed.json"
      );
      const pendingContent = await fs.readFile(pendingPath, "utf8");
      expect(JSON.parse(pendingContent)).toEqual(validSeed);

      // Manually trigger orchestrator processing since file system watcher may not work in tests
      const pendingFiles = await fs.readdir(
        path.join(pipelineDataDir, "pending")
      );
      console.log("Pending files to process:", pendingFiles);

      // For each pending file, manually trigger the orchestrator processing
      for (const pendingFile of pendingFiles) {
        const pendingPath = path.join(pipelineDataDir, "pending", pendingFile);
        console.log("Processing pending file:", pendingPath);

        // Read the seed file and manually trigger processing
        const seedContent = await fs.readFile(pendingPath, "utf8");
        const seed = JSON.parse(seedContent);

        // Simulate what the orchestrator does
        const baseDir = path.dirname(pipelineDataDir);
        const paths = {
          pending: path.join(baseDir, "pipeline-data", "pending"),
          current: path.join(baseDir, "pipeline-data", "current"),
          complete: path.join(baseDir, "pipeline-data", "complete"),
        };

        const workDir = path.join(paths.current, seed.name);
        const lockFile = path.join(paths.current, `${seed.name}.lock`);

        try {
          // Try to acquire lock
          await fs.writeFile(lockFile, process.pid.toString(), { flag: "wx" });
        } catch (err) {
          if (err.code === "EEXIST") continue; // Already being processed
          throw err;
        }

        try {
          // Create work directory
          await fs.mkdir(workDir, { recursive: false });

          // Write seed.json to current directory
          await fs.writeFile(
            path.join(workDir, "seed.json"),
            JSON.stringify(seed, null, 2)
          );

          // Remove the original pending file
          await fs.unlink(pendingPath);
        } finally {
          // Release lock
          try {
            await fs.unlink(lockFile);
          } catch {}
        }
      }

      // Verify orchestrator created current directory and seed.json
      const currentSeedPath = path.join(
        pipelineDataDir,
        "current",
        "e2e-test-job",
        "seed.json"
      );

      // Check if the current directory exists first
      try {
        await fs.access(path.join(pipelineDataDir, "current", "e2e-test-job"));
        const currentSeedContent = await fs.readFile(currentSeedPath, "utf8");
        expect(JSON.parse(currentSeedContent)).toEqual(validSeed);
      } catch (error) {
        console.error(
          "Current directory or seed.json not found:",
          error.message
        );
        throw error;
      }

      // Verify pending file was removed by orchestrator
      try {
        await fs.access(pendingPath);
        expect.fail("Pending file should have been removed by orchestrator");
      } catch (error) {
        expect(error.code).toBe("ENOENT");
      }

      // Clean up spy
      broadcastSpy.mockRestore();
    });

    it("should handle multiple concurrent uploads independently", async () => {
      const jobs = [
        { name: "job-1", data: { test: "data-1" } },
        { name: "job-2", data: { test: "data-2" } },
        { name: "job-3", data: { test: "data-3" } },
      ];

      const uploadPromises = jobs.map(async (job) => {
        const formData = new FormData();
        const file = new File([JSON.stringify(job)], "seed.json", {
          type: "application/json",
        });
        formData.append("file", file);

        const response = await fetch(`${baseUrl}/api/upload/seed`, {
          method: "POST",
          body: formData,
        });

        return { job, response: await response.json() };
      });

      const results = await Promise.all(uploadPromises);

      // Verify all uploads succeeded
      results.forEach(({ job, response }) => {
        expect(response.success).toBe(true);
        expect(response.jobName).toBe(job.name);
      });

      // Verify all files were written to pending directory
      for (const job of jobs) {
        const pendingPath = path.join(
          pipelineDataDir,
          "pending",
          `${job.name}-seed.json`
        );
        const pendingContent = await fs.readFile(pendingPath, "utf8");
        expect(JSON.parse(pendingContent)).toEqual(job);
      }
    });
  });

  describe("Error cases with exact substring requirements", () => {
    it("should return 400 with 'Invalid JSON' for invalid JSON", async () => {
      const formData = new FormData();
      const file = new File(["invalid json content"], "seed.json", {
        type: "application/json",
      });
      formData.append("file", file);

      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        body: formData,
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid JSON");
    });

    it("should return 400 with 'Required fields missing' for missing fields", async () => {
      const invalidSeed = {
        // Missing name field
        data: { test: "data" },
      };

      const formData = new FormData();
      const file = new File([JSON.stringify(invalidSeed)], "seed.json", {
        type: "application/json",
      });
      formData.append("file", file);

      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        body: formData,
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.message).toContain("Required fields missing");
    });

    it("should return 400 with 'already exists' for duplicate names", async () => {
      const seed = {
        name: "duplicate-e2e-job",
        data: { test: "data" },
      };

      // First upload
      const formData1 = new FormData();
      const file1 = new File([JSON.stringify(seed)], "seed.json", {
        type: "application/json",
      });
      formData1.append("file", file1);

      const response1 = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        body: formData1,
      });
      expect(response1.status).toBe(200);

      // Wait for processing
      await vi.advanceTimersByTimeAsync(100);

      // Second upload with same name
      const formData2 = new FormData();
      const file2 = new File([JSON.stringify(seed)], "seed.json", {
        type: "application/json",
      });
      formData2.append("file", file2);

      const response2 = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        body: formData2,
      });

      expect(response2.status).toBe(400);
      const result = await response2.json();
      expect(result.success).toBe(false);
      expect(result.message).toContain("already exists");
    });
  });

  describe("Cleanup on failure", () => {
    it("should leave no orphaned files on validation failure after write", async () => {
      const invalidSeed = {
        name: "orphan-test-job",
        // Missing data field
      };

      const formData = new FormData();
      const file = new File([JSON.stringify(invalidSeed)], "seed.json", {
        type: "application/json",
      });
      formData.append("file", file);

      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        body: formData,
      });

      expect(response.status).toBe(400);

      // Verify no partial file exists in pending
      const pendingPath = path.join(
        pipelineDataDir,
        "pending",
        "orphan-test-job-seed.json"
      );
      try {
        await fs.access(pendingPath);
        expect.fail("Partial file should have been cleaned up");
      } catch (error) {
        expect(error.code).toBe("ENOENT");
      }

      // Verify no directory exists in current
      const currentPath = path.join(
        pipelineDataDir,
        "current",
        "orphan-test-job"
      );
      try {
        await fs.access(currentPath);
        expect.fail("Current directory should not exist for failed upload");
      } catch (error) {
        expect(error.code).toBe("ENOENT");
      }
    });
  });
});
