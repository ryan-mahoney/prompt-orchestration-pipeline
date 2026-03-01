import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stopJob } from "../src/ui/client/api.js";

describe("stopJob", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should make POST request to stop endpoint with correct headers", async () => {
    const mockResponse = {
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ ok: true, jobId: "test-job", stopped: true }),
    };
    fetch.mockResolvedValue(mockResponse);

    const result = await stopJob("test-job");

    expect(fetch).toHaveBeenCalledWith("/api/jobs/test-job/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    expect(result).toEqual({ ok: true, jobId: "test-job", stopped: true });
  });

  it("should encode job ID in URL", async () => {
    const mockResponse = {
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          jobId: "job/with/slashes",
          stopped: true,
        }),
    };
    fetch.mockResolvedValue(mockResponse);

    await stopJob("job/with/slashes");

    expect(fetch).toHaveBeenCalledWith("/api/jobs/job%2Fwith%2Fslashes/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  it("should handle 404 error with structured error", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      json: vi
        .fn()
        .mockResolvedValue({ code: "not_found", message: "Job not found" }),
    };
    fetch.mockResolvedValue(mockResponse);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "job_not_found",
      message: "Job not found.",
      status: 404,
    });
  });

  it("should handle 409 error with structured error", async () => {
    const mockResponse = {
      ok: false,
      status: 409,
      json: vi
        .fn()
        .mockResolvedValue({ code: "conflict", message: "Job stop conflict" }),
    };
    fetch.mockResolvedValue(mockResponse);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "conflict",
      message: "Job stop conflict.",
      status: 409,
    });
  });

  it("should handle 500 error with structured error", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi
        .fn()
        .mockResolvedValue({ code: "internal_error", message: "Server error" }),
    };
    fetch.mockResolvedValue(mockResponse);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "spawn_failed",
      message: "Internal server error",
      status: 500,
    });
  });

  it("should handle JSON parsing error in error response", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
      statusText: "Internal Server Error",
    };
    fetch.mockResolvedValue(mockResponse);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "spawn_failed",
      message: "Internal Server Error",
      status: 500,
    });
  });

  it("should handle network error", async () => {
    const networkError = new Error("Network error");
    fetch.mockRejectedValue(networkError);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "network_error",
      message: "Network error",
    });
  });

  it("should handle network error with no message", async () => {
    const networkError = new Error();
    delete networkError.message;
    fetch.mockRejectedValue(networkError);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "network_error",
      message: "Failed to connect to server",
    });
  });

  it("should use error code from response when available", async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: vi
        .fn()
        .mockResolvedValue({ code: "custom_error", message: "Custom error" }),
    };
    fetch.mockResolvedValue(mockResponse);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "custom_error",
      message: "Custom error",
      status: 400,
    });
  });

  it("should use default error message for unknown status code", async () => {
    const mockResponse = {
      ok: false,
      status: 418,
      json: vi.fn().mockResolvedValue({ message: "I'm a teapot" }),
    };
    fetch.mockResolvedValue(mockResponse);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "unknown_error",
      message: "I'm a teapot",
      status: 418,
    });
  });

  it("should use fallback message for unknown status code when no error message provided", async () => {
    const mockResponse = {
      ok: false,
      status: 418,
      json: vi.fn().mockResolvedValue({}),
    };
    fetch.mockResolvedValue(mockResponse);

    await expect(stopJob("test-job")).rejects.toEqual({
      code: "unknown_error",
      message: "Request failed with status 418",
      status: 418,
    });
  });
});
