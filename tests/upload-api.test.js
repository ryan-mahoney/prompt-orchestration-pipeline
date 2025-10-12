/**
 * Tests for the upload API functionality (Step 2)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { startTestServer } from "./utils/serverHelper.js";
import { createTempDir } from "./test-utils.js";

// Use native fetch - rely on test timeouts for hanging prevention
const fetchWithTimeout = fetch;

describe("Upload API (Step 2)", () => {
  let tempDir;
  let srv;
  let baseUrl;

  beforeEach(async () => {
    tempDir = await createTempDir();
    process.env.PO_ROOT = tempDir;
    process.env.NODE_ENV = "test";

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

    srv = await startTestServer({ dataDir: tempDir, port: 0 });
    baseUrl = srv.url;
  });

  afterEach(async () => {
    console.log("Cleaning up test...");
    if (srv) {
      console.log("Closing server...");
      await srv.close();
      console.log("Server closed");
    }
    if (tempDir) {
      console.log("Removing temp directory...");
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log("Temp directory removed");
    }
    delete process.env.PO_ROOT;
    console.log("Cleanup complete");
  });

  describe("POST /api/upload/seed", () => {
    it("should accept valid seed file upload", async () => {
      const validSeed = {
        name: "test-job-1",
        data: { test: "data" },
      };

      // Create multipart form data manually (Node.js compatible)
      const boundary = "WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        JSON.stringify(validSeed),
        `--${boundary}--`,
        "",
      ].join("\r\n");

      console.log("Making fetch request...");
      const response = await fetchWithTimeout(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      console.log("Fetch request completed, status:", response.status);

      // Check if response body exists before parsing
      const responseText = await response.text();
      console.log("Response text:", responseText);

      let result;
      try {
        result = JSON.parse(responseText);
        console.log("Response JSON parsed:", result);
      } catch (error) {
        console.error("Failed to parse JSON:", error);
        throw error;
      }

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.jobName).toBe("test-job-1");
      expect(result.jobId).toMatch(/^[A-Za-z0-9]{12}$/); // 12 char random ID
      expect(result.message).toBe("Seed file uploaded successfully");

      // No need to wait - file should be written immediately
      console.log(
        "Skipping atomic write wait - file should be written immediately"
      );

      // Verify file was written to pending directory with jobId as filename
      const pendingPath = path.join(
        tempDir,
        "pipeline-data",
        "pending",
        `${result.jobId}-seed.json`
      );
      console.log("Checking file at:", pendingPath);

      // Check if file exists first
      try {
        await fs.access(pendingPath);
        console.log("File exists");
      } catch (error) {
        console.error("File does not exist:", error);
        throw error;
      }

      const fileContent = await fs.readFile(pendingPath, "utf8");
      console.log("File content read successfully");
      expect(JSON.parse(fileContent)).toEqual(validSeed);
      console.log("File content validation passed");
    }, 60000); // 60 second timeout

    it("should reject invalid JSON", async () => {
      // Create multipart form data manually (Node.js compatible)
      const boundary = "WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        "invalid json",
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const response = await fetchWithTimeout(`${baseUrl}/api/upload/seed`, {
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
      const boundary = "WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        JSON.stringify(invalidSeed),
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const response = await fetchWithTimeout(`${baseUrl}/api/upload/seed`, {
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

    it("should allow duplicate job names with different job IDs", async () => {
      const seed = {
        name: "duplicate-job",
        data: { test: "data" },
      };

      // Create multipart form data manually (Node.js compatible)
      const boundary = "WebKitFormBoundary7MA4YWxkTrZu0gW";
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
      console.log("Making first fetch request...");
      const response1 = await fetchWithTimeout(`${baseUrl}/api/upload/seed`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      console.log("First fetch request completed, status:", response1.status);
      expect(response1.status).toBe(200);

      const result1 = await response1.json();
      expect(result1.success).toBe(true);
      expect(result1.jobId).toMatch(/^[A-Za-z0-9]{12}$/);

      // Second upload should also succeed with different ID
      console.log("Making second fetch request...");
      let response2;
      try {
        response2 = await fetchWithTimeout(`${baseUrl}/api/upload/seed`, {
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body,
        });
        console.log(
          "Second fetch request completed, status:",
          response2.status
        );
      } catch (error) {
        console.error("Second fetch request failed:", error);
        throw error;
      }

      expect(response2.status).toBe(200);
      const result2 = await response2.json();
      expect(result2.success).toBe(true);
      expect(result2.jobId).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(result2.jobId).not.toBe(result1.jobId); // Different IDs
      expect(result2.jobName).toBe(result1.jobName); // Same name
    }, 60000); // 60 second timeout

    it("should clean up partial files on validation failure", async () => {
      const invalidSeed = {
        name: "partial-job",
        // Missing data field
      };

      // Create multipart form data manually (Node.js compatible)
      const boundary = "WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="seed.json"',
        "Content-Type: application/json",
        "",
        JSON.stringify(invalidSeed),
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const response = await fetchWithTimeout(`${baseUrl}/api/upload/seed`, {
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
