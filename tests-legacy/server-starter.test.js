import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startTestServer } from "./utils/serverHelper.js";

describe("startServer API", () => {
  let serverInstance;

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.close();
      serverInstance = null;
    }
  });

  it("should start server with dataDir and return { url, close }", async () => {
    const tempDataDir = "/tmp/test-data-dir";

    serverInstance = await startTestServer({
      dataDir: tempDataDir,
      port: 0, // Use port 0 to get a random available port
    });

    expect(serverInstance).toHaveProperty("url");
    expect(serverInstance).toHaveProperty("close");
    expect(typeof serverInstance.close).toBe("function");

    // URL should be a string starting with http://
    expect(serverInstance.url).toMatch(/^http:\/\/localhost:\d+$/);

    // Verify the server is accessible
    const response = await fetch(`${serverInstance.url}/api/state`);
    expect(response.status).toBe(200);
  });

  it("should start server without dataDir", async () => {
    serverInstance = await startTestServer({
      port: 0,
    });

    expect(serverInstance).toHaveProperty("url");
    expect(serverInstance).toHaveProperty("close");

    // Verify the server is accessible
    const response = await fetch(`${serverInstance.url}/api/state`);
    expect(response.status).toBe(200);
  });

  it("should close server cleanly", async () => {
    serverInstance = await startTestServer({
      dataDir: "/tmp/test-data-dir",
      port: 0,
    });

    const url = serverInstance.url;

    // Verify server is running
    const response = await fetch(`${url}/api/state`);
    expect(response.status).toBe(200);

    // Close server
    await serverInstance.close();
    serverInstance = null;

    // Verify server is no longer accessible
    try {
      await fetch(`${url}/api/state`);
      // If we get here, the server is still running
      expect.fail("Server should be closed");
    } catch (error) {
      // Expected - server should be closed
      expect(error).toBeDefined();
    }
  });

  it("should handle port conflicts gracefully", async () => {
    // Start first server
    const firstServer = await startTestServer({
      dataDir: "/tmp/test-data-dir",
      port: 0,
    });

    // Try to start second server on same port (should fail)
    const port = parseInt(firstServer.url.split(":")[2]);

    try {
      await startTestServer({
        dataDir: "/tmp/test-data-dir",
        port: port, // Same port as first server
      });
      expect.fail("Should have thrown error for port conflict");
    } catch (error) {
      // Verify we get a structured error with EADDRINUSE code
      expect(error).toBeDefined();
      expect(error.code).toBe("EADDRINUSE");
      expect(error.message).toContain(`Port ${port} is already in use`);
    } finally {
      await firstServer.close();
    }
  });
});
