/**
 * Tests for SSE Server functionality (Step 3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { createServer } from "../src/ui/server.js";
import { createTempDir } from "./test-utils.js";

describe("SSE Server (Step 3)", () => {
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

  describe("GET /api/events", () => {
    it("should establish SSE connection and receive initial state", async () => {
      const events = [];

      const eventSource = new EventSource(`${baseUrl}/api/events`);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("SSE connection timeout"));
        }, 5000);

        eventSource.addEventListener("state", (event) => {
          try {
            const data = JSON.parse(event.data);
            expect(data).toBeDefined();
            events.push({ type: "state", data });
            clearTimeout(timeout);
            eventSource.close();
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            eventSource.close();
            reject(error);
          }
        });

        eventSource.onerror = (error) => {
          clearTimeout(timeout);
          eventSource.close();
          reject(error);
        };
      });
    });

    it("should broadcast seed:uploaded event on successful upload", async () => {
      const events = [];
      const validSeed = {
        name: "test-sse-job",
        data: { test: "sse data" },
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

      // Set up SSE connection first
      const eventSource = new EventSource(`${baseUrl}/api/events`);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          eventSource.close();
          reject(new Error("SSE event timeout"));
        }, 5000);

        eventSource.addEventListener("seed:uploaded", (event) => {
          try {
            const data = JSON.parse(event.data);
            expect(data.jobName).toBe("test-sse-job");
            events.push({ type: "seed:uploaded", data });
            clearTimeout(timeout);
            eventSource.close();
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            eventSource.close();
            reject(error);
          }
        });

        // Perform upload after SSE connection is established
        setTimeout(async () => {
          try {
            const response = await fetch(`${baseUrl}/api/upload/seed`, {
              method: "POST",
              headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
              },
              body,
            });

            const result = await response.json();
            expect(response.status).toBe(200);
            expect(result.success).toBe(true);
          } catch (error) {
            clearTimeout(timeout);
            eventSource.close();
            reject(error);
          }
        }, 100);
      });
    });

    it("should handle multiple SSE clients", async () => {
      const events1 = [];
      const events2 = [];

      const eventSource1 = new EventSource(`${baseUrl}/api/events`);
      const eventSource2 = new EventSource(`${baseUrl}/api/events`);

      const validSeed = {
        name: "multi-client-job",
        data: { test: "multi client" },
      };

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

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          eventSource1.close();
          eventSource2.close();
          reject(new Error("Multiple SSE clients timeout"));
        }, 5000);

        let received1 = false;
        let received2 = false;

        const checkComplete = () => {
          if (received1 && received2) {
            clearTimeout(timeout);
            eventSource1.close();
            eventSource2.close();
            resolve();
          }
        };

        eventSource1.addEventListener("seed:uploaded", (event) => {
          try {
            const data = JSON.parse(event.data);
            expect(data.jobName).toBe("multi-client-job");
            events1.push({ type: "seed:uploaded", data });
            received1 = true;
            checkComplete();
          } catch (error) {
            clearTimeout(timeout);
            eventSource1.close();
            eventSource2.close();
            reject(error);
          }
        });

        eventSource2.addEventListener("seed:uploaded", (event) => {
          try {
            const data = JSON.parse(event.data);
            expect(data.jobName).toBe("multi-client-job");
            events2.push({ type: "seed:uploaded", data });
            received2 = true;
            checkComplete();
          } catch (error) {
            clearTimeout(timeout);
            eventSource1.close();
            eventSource2.close();
            reject(error);
          }
        });

        // Perform upload after SSE connections are established
        setTimeout(async () => {
          try {
            const response = await fetch(`${baseUrl}/api/upload/seed`, {
              method: "POST",
              headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
              },
              body,
            });

            const result = await response.json();
            expect(response.status).toBe(200);
            expect(result.success).toBe(true);
          } catch (error) {
            clearTimeout(timeout);
            eventSource1.close();
            eventSource2.close();
            reject(error);
          }
        }, 100);
      });
    });
  });
});
