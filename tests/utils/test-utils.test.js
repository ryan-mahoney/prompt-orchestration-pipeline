import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import {
  createTempPipelineDir,
  startOrchestrator,
  setupTestEnvironment,
  restoreRealTimers,
} from "./index.js";
import { startTestServer } from "./serverHelper.js";

describe("Test Utilities for E2E", () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    restoreRealTimers();
  });

  describe("createTempPipelineDir", () => {
    it("should create temporary pipeline directory structure", async () => {
      const pipelineDataDir = await createTempPipelineDir();

      expect(pipelineDataDir).toBeDefined();
      expect(pipelineDataDir).toContain("pipeline-test-");
      expect(pipelineDataDir).toContain("pipeline-data");

      // Verify the directory structure was created
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const pendingDir = path.join(pipelineDataDir, "pending");
      const currentDir = path.join(pipelineDataDir, "current");
      const completeDir = path.join(pipelineDataDir, "complete");

      await expect(fs.access(pendingDir)).resolves.not.toThrow();
      await expect(fs.access(currentDir)).resolves.not.toThrow();
      await expect(fs.access(completeDir)).resolves.not.toThrow();

      // Clean up
      await fs.rm(pipelineDataDir, {
        recursive: true,
        force: true,
      });
    });
  });

  describe("startServer", () => {
    it("should start server with provided data directory", async () => {
      const pipelineDataDir = await createTempPipelineDir();
      const server = await startTestServer({
        dataDir: pipelineDataDir,
        port: 0,
      });

      expect(server).toBeDefined();
      expect(server.url).toBeDefined();
      expect(server.close).toBeInstanceOf(Function);

      // Verify server is running by checking the URL
      expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);

      // Clean up
      await server.close();
      const fs = await import("node:fs/promises");
      await fs.rm(pipelineDataDir, {
        recursive: true,
        force: true,
      });
    });
  });

  describe("startOrchestrator", () => {
    it("should start orchestrator with provided data directory", async () => {
      const pipelineDataDir = await createTempPipelineDir();
      const orchestrator = await startOrchestrator({
        dataDir: pipelineDataDir,
      });

      expect(orchestrator).toBeDefined();
      expect(orchestrator.stop).toBeInstanceOf(Function);

      // Clean up
      await orchestrator.stop();
      const fs = await import("node:fs/promises");
      await fs.rm(pipelineDataDir, {
        recursive: true,
        force: true,
      });
    });
  });

  describe("Environment Setup", () => {
    it("should configure fake timers", () => {
      // Fake timers should be configured by setupTestEnvironment
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      // This should use fake timers
      const timer = setTimeout(() => {}, 1000);

      expect(setTimeoutSpy).toHaveBeenCalled();
      clearTimeout(timer);
    });

    it("should provide File polyfill in Node.js environment", () => {
      expect(global.File).toBeDefined();
      expect(global.File).toBeInstanceOf(Function);

      // Test File constructor
      const file = new File(["test content"], "test.json", {
        type: "application/json",
      });
      expect(file.name).toBe("test.json");
      expect(file.size).toBe(12); // "test content" length
    });

    it("should provide EventSource polyfill in Node.js environment", () => {
      expect(global.EventSource).toBeDefined();
      expect(global.EventSource).toBeInstanceOf(Function);

      // Test EventSource constructor
      const eventSource = new EventSource("http://localhost:3000/api/events");
      expect(eventSource.url).toBe("http://localhost:3000/api/events");
      expect(eventSource.readyState).toBe(0); // CONNECTING

      eventSource.close();
    });
  });
});
