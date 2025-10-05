/**
 * End-to-End Upload Test (Step 8)
 * Tests the complete upload flow using test utilities from Step 7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createTempPipelineDir,
  startServer,
  startOrchestrator,
  setupTestEnvironment,
  restoreRealTimers,
} from "./utils/index.js";

describe("E2E Upload Flow", () => {
  let pipelineDataDir;
  let server;
  let orchestrator;
  let baseUrl;

  beforeEach(async () => {
    setupTestEnvironment();

    // Create temporary pipeline directory using Step 7 utility
    pipelineDataDir = await createTempPipelineDir();

    // Start server using Step 7 utility - pass the parent directory as base
    const baseDir = path.dirname(pipelineDataDir);
    server = await startServer({ dataDir: baseDir, port: 0 });
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

  describe("Valid upload flow", () => {
    it("should complete full upload → SSE → orchestrator pickup flow", async () => {
      const validSeed = {
        name: "e2e-test-job",
        data: { test: "e2e data" },
      };

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

      // Verify file was written to pending directory
      const pendingPath = path.join(
        pipelineDataDir,
        "pending",
        "e2e-test-job-seed.json"
      );
      const pendingContent = await fs.readFile(pendingPath, "utf8");
      expect(JSON.parse(pendingContent)).toEqual(validSeed);
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
