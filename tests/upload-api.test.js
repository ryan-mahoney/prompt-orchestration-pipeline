/**
 * Tests for the upload API functionality (Step 2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { createServer } from "../src/ui/server.js";
import { createTempDir } from "./test-utils.js";

describe("Upload API (Step 2)", () => {
  let tempDir;
  let server;
  let baseUrl;

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

    server = createServer();
    // Use a random port for testing
    server.listen(0);

    // Get the actual port the server is listening on
    const address = server.address();
    baseUrl = `http://localhost:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      server.close();
      // Wait for server to fully close
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    delete process.env.PO_ROOT;
  });

  describe("POST /api/upload/seed", () => {
    it("should accept valid seed file upload", async () => {
      const validSeed = {
        name: "test-job-1",
        data: { test: "data" },
      };

      // Create multipart form data manually (Node.js compatible)
      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        JSON.stringify(validSeed),
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual({
        success: true,
        jobName: "test-job-1",
        message: "Seed file uploaded successfully",
      });

      // Wait a moment for atomic write to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify file was written to pending directory
      const pendingPath = path.join(
        tempDir,
        "pipeline-data",
        "pending",
        "test-job-1-seed.json"
      );
      const fileContent = await fs.readFile(pendingPath, "utf8");
      expect(JSON.parse(fileContent)).toEqual(validSeed);
    });

    it("should reject invalid JSON", async () => {
      // Create multipart form data manually (Node.js compatible)
      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        "invalid json",
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.message).toBe("Invalid JSON");
    });

    it("should reject missing required fields", async () => {
      const invalidSeed = {
        // Missing name field
        data: { test: "data" },
      };

      // Create multipart form data manually (Node.js compatible)
      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        JSON.stringify(invalidSeed),
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.message).toBe("Required fields missing");
    });

    it("should reject duplicate job names", async () => {
      const seed = {
        name: "duplicate-job",
        data: { test: "data" },
      };

      // Create multipart form data manually (Node.js compatible)
      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        JSON.stringify(seed),
        `--${boundary}--`,
        "",
      ].join("\r\n");

      // First upload should succeed
      const response1 = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      expect(response1.status).toBe(200);

      // Wait a moment for atomic write to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second upload should fail
      const response2 = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(response2.status).toBe(400);
      const result = await response2.json();
      expect(result.success).toBe(false);
      expect(result.message).toContain("already exists");
    });

    it("should clean up partial files on validation failure", async () => {
      const invalidSeed = {
        name: "partial-job",
        // Missing data field
      };

      // Create multipart form data manually (Node.js compatible)
      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        JSON.stringify(invalidSeed),
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const response = await fetch(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(response.status).toBe(400);

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
  });
});
