/**
 * Direct tests for the upload handler functionality (Step 2)
 * Tests the handler logic without HTTP server overhead
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { submitJobWithValidation } from "../src/api/index.js";
import { createTempDir } from "./test-utils.js";

describe("Upload Handler (Step 2)", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir();
    process.env.PO_ROOT = tempDir;

    // Create necessary directories
    await fs.mkdir(path.join(tempDir, "pipeline-data", "pending"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempDir, "pipeline-data", "current"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempDir, "pipeline-data", "complete"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    delete process.env.PO_ROOT;
  });

  describe("submitJobWithValidation", () => {
    it("should accept valid seed object", async () => {
      const validSeed = {
        name: "test-job-1",
        data: { test: "data" },
        pipeline: "content",
      };

      const result = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: validSeed,
      });

      expect(result.success).toBe(true);
      expect(result.jobName).toBe("test-job-1");
      expect(result.jobId).toMatch(/^[A-Za-z0-9]{12}$/); // 12 char random ID
      expect(result.message).toBe("Seed file uploaded successfully");

      // Verify file was written to pending directory with jobId as filename
      const pendingPath = path.join(
        tempDir,
        "pipeline-data",
        "pending",
        `${result.jobId}-seed.json`
      );
      const fileContent = await fs.readFile(pendingPath, "utf8");
      expect(JSON.parse(fileContent)).toEqual(validSeed);
    });

    it("should reject invalid seed object", async () => {
      const result = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: "invalid json", // This should fail validation
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Required fields missing");
    });

    it("should reject missing required fields", async () => {
      const invalidSeed = {
        // Missing name field
        data: { test: "data" },
        pipeline: "content",
      };

      const result = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: invalidSeed,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Required fields missing");
    });

    it("should allow duplicate job names with different job IDs", async () => {
      const seed = {
        name: "duplicate-job",
        data: { test: "data" },
        pipeline: "content",
      };

      // First upload should succeed
      const result1 = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: seed,
      });
      expect(result1.success).toBe(true);
      expect(result1.jobId).toMatch(/^[A-Za-z0-9]{12}$/);

      // Second upload should also succeed with different ID
      const result2 = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: seed,
      });

      expect(result2.success).toBe(true);
      expect(result2.jobId).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(result2.jobId).not.toBe(result1.jobId); // Different IDs
      expect(result2.jobName).toBe(result1.jobName); // Same name
    });

    it("should clean up partial files on validation failure", async () => {
      const invalidSeed = {
        name: "partial-job",
        // Missing data field
        pipeline: "content",
      };

      const result = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: invalidSeed,
      });

      expect(result.success).toBe(false);

      // Verify no partial file exists
      const pendingPath = path.join(
        tempDir,
        "pipeline-data",
        "pending",
        "partial-job-seed.json"
      );
      try {
        await fs.access(pendingPath);
        // If we get here, the file exists which is a problem
        expect.fail("Partial file should have been cleaned up");
      } catch (error) {
        // File doesn't exist, which is expected
        expect(error.code).toBe("ENOENT");
      }
    });

    it("should reject missing pipeline field", async () => {
      const invalidSeed = {
        name: "test-job",
        data: { test: "data" },
        // Missing pipeline field
      };

      const result = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: invalidSeed,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Required fields missing");
    });

    it("should reject unknown pipeline slug", async () => {
      const invalidSeed = {
        name: "test-job",
        data: { test: "data" },
        pipeline: "unknown-slug",
      };

      const result = await submitJobWithValidation({
        dataDir: tempDir,
        seedObject: invalidSeed,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain(
        "Pipeline unknown-slug not found in registry"
      );
    });
  });
});
