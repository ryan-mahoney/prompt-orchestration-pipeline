import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { restartJob } from "../src/ui/client/api.js";

describe("API Client - restartJob", () => {
  let fetchMock;

  beforeEach(() => {
    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should make POST request with correct headers and body", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        jobId: "test-job-123",
        mode: "clean-slate",
        spawned: true,
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    const result = await restartJob("test-job-123");

    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/test-job-123/restart", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "clean-slate",
        options: {
          clearTokenUsage: true,
        },
      }),
    });

    expect(result).toEqual({
      ok: true,
      jobId: "test-job-123",
      mode: "clean-slate",
      spawned: true,
    });
  });

  it("should handle custom options", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await restartJob("test-job-123", {
      options: {
        clearTokenUsage: false,
        customOption: "value",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/test-job-123/restart", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "clean-slate",
        options: {
          clearTokenUsage: false,
          customOption: "value",
        },
      }),
    });
  });

  it("should properly encode job ID in URL", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await restartJob("job/with/special-chars");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job%2Fwith%2Fspecial-chars/restart",
      expect.any(Object)
    );
  });

  it("should throw structured error for 404 response", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "job_not_found",
        message: "Job not found",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(restartJob("non-existent")).rejects.toEqual({
      code: "job_not_found",
      message: "Job not found.",
      status: 404,
    });
  });

  it("should throw structured error for 409 response", async () => {
    const mockResponse = {
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "job_running",
        message: "Job is currently running",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(restartJob("running-job")).rejects.toEqual({
      code: "job_running",
      message: "Job is currently running; restart is unavailable.",
      status: 409,
    });
  });

  it("should throw structured error for 500 response", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "spawn_failed",
        message: "Failed to start restart",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(restartJob("failed-job")).rejects.toEqual({
      code: "spawn_failed",
      message: "Failed to start restart. Try again.",
      status: 500,
    });
  });

  it("should handle missing error response body gracefully", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(restartJob("test-job")).rejects.toEqual({
      code: "job_not_found",
      message: "Job not found.",
      status: 404,
    });
  });

  it("should handle network errors", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    await expect(restartJob("test-job")).rejects.toEqual({
      code: "network_error",
      message: "Network error",
    });
  });

  it("should handle network errors without message", async () => {
    const error = new Error();
    error.message = undefined;
    fetchMock.mockRejectedValue(error);

    await expect(restartJob("test-job")).rejects.toEqual({
      code: "network_error",
      message: "Failed to connect to server",
    });
  });

  it("should re-throw structured errors as-is", async () => {
    const mockResponse = {
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "some_other_error",
        message: "Some other error message",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(restartJob("test-job")).rejects.toEqual({
      code: "some_other_error",
      message: "Some other error message",
      status: 409,
    });
  });
});
