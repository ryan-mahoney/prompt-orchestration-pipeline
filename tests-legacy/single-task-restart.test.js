/**
 * Tests for single-task restart functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { restartJob } from "../src/ui/client/api.js";

describe("Single-Task Restart", () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("restartJob API", () => {
    it("should include singleTask parameter in request body when true", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await restartJob("test-job", {
        fromTask: "analysis",
        singleTask: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/jobs/test-job/restart",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"singleTask":true'),
        })
      );
    });

    it("should include singleTask parameter in request body when false", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await restartJob("test-job", {
        fromTask: "analysis",
        singleTask: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/jobs/test-job/restart",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"singleTask":false'),
        })
      );
    });

    it("should not include singleTask parameter when undefined", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await restartJob("test-job", {
        fromTask: "analysis",
      });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody).not.toHaveProperty("singleTask");
    });

    it("should handle clean-slate restart with singleTask", async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await restartJob("test-job", {
        singleTask: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/jobs/test-job/restart",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"mode":"clean-slate"'),
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody).toEqual({
        mode: "clean-slate",
        options: {
          clearTokenUsage: true,
        },
        singleTask: true,
      });
    });
  });

  describe("Task name normalization", () => {
    it("should correctly identify task position with object-format tasks", () => {
      const getTaskName = (t) => (typeof t === "string" ? t : t.name);

      const objectTasks = [
        { name: "ingest" },
        { name: "process" },
        { name: "analyze" },
        { name: "export" },
      ];

      const taskNames = objectTasks.map(getTaskName);
      const startFromTask = "analyze";

      // Verify indexOf works correctly with normalized names
      expect(taskNames.indexOf("ingest")).toBe(0);
      expect(taskNames.indexOf("analyze")).toBe(2);
      expect(taskNames.indexOf(startFromTask)).toBe(2);

      // Verify skip logic would work
      const shouldSkip = (taskName) =>
        taskNames.indexOf(taskName) < taskNames.indexOf(startFromTask);

      expect(shouldSkip("ingest")).toBe(true);
      expect(shouldSkip("process")).toBe(true);
      expect(shouldSkip("analyze")).toBe(false);
      expect(shouldSkip("export")).toBe(false);
    });

    it("should handle mixed string and object task formats", () => {
      const getTaskName = (t) => (typeof t === "string" ? t : t.name);

      const mixedTasks = [
        "ingest",
        { name: "process" },
        "analyze",
        { name: "export" },
      ];

      const taskNames = mixedTasks.map(getTaskName);

      expect(taskNames).toEqual(["ingest", "process", "analyze", "export"]);
    });
  });
});
