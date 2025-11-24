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
});
