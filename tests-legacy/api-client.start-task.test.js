import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startTask } from "../src/ui/client/api.js";

describe("API Client - startTask", () => {
  let fetchMock;

  beforeEach(() => {
    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should make POST request with correct URL and headers", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        jobId: "test-job-123",
        taskId: "research",
        mode: "single-task-start",
        spawned: true,
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    const result = await startTask("test-job-123", "research");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/test-job-123/tasks/research/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    expect(result).toEqual({
      ok: true,
      jobId: "test-job-123",
      taskId: "research",
      mode: "single-task-start",
      spawned: true,
    });
  });

  it("should properly encode job ID and task ID in URL", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await startTask("job/with/special-chars", "task/with/special-chars");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job%2Fwith%2Fspecial-chars/tasks/task%2Fwith%2Fspecial-chars/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  });

  it("should return parsed JSON on successful response", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        jobId: "job-456",
        taskId: "analysis",
        mode: "single-task-start",
        spawned: true,
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    const result = await startTask("job-456", "analysis");

    expect(result).toEqual({
      ok: true,
      jobId: "job-456",
      taskId: "analysis",
      mode: "single-task-start",
      spawned: true,
    });
  });

  it("should throw structured error for 404 response with job_not_found code", async () => {
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

    await expect(startTask("non-existent", "research")).rejects.toEqual({
      code: "job_not_found",
      message: "Job not found.",
      status: 404,
    });
  });

  it("should throw structured error for 409 response with job_running code", async () => {
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

    await expect(startTask("running-job", "research")).rejects.toEqual({
      code: "job_running",
      message: "Job is currently running; start is unavailable.",
      status: 409,
    });
  });

  it("should throw structured error for 409 response with dependencies_not_satisfied code", async () => {
    const mockResponse = {
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "dependencies_not_satisfied",
        message: "Dependencies not satisfied for task",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(startTask("job-123", "analysis")).rejects.toEqual({
      code: "dependencies_not_satisfied",
      message: "Dependencies not satisfied for task.",
      status: 409,
    });
  });

  it("should throw structured error for 409 response with unsupported_lifecycle code", async () => {
    const mockResponse = {
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "unsupported_lifecycle",
        message: "Job must be in current to start a task",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(startTask("completed-job", "research")).rejects.toEqual({
      code: "unsupported_lifecycle",
      message: "Job must be in current to start a task.",
      status: 409,
    });
  });

  it("should throw generic structured error for 409 response with unknown code", async () => {
    const mockResponse = {
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "some_other_conflict",
        message: "Some conflict occurred",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(startTask("job-123", "research")).rejects.toEqual({
      code: "some_other_conflict",
      message: "Request conflict.",
      status: 409,
    });
  });

  it("should throw structured error for 400 response with custom message", async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "task_not_found",
        message: "Task not found in job",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(startTask("job-123", "nonexistent")).rejects.toEqual({
      code: "task_not_found",
      message: "Task not found in job",
      status: 400,
    });
  });

  it("should throw default structured error for 400 response without message", async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "task_not_found",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(startTask("job-123", "nonexistent")).rejects.toEqual({
      code: "task_not_found",
      message: "Bad request",
      status: 400,
    });
  });

  it("should throw structured error for 500 response", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        ok: false,
        code: "internal_error",
        message: "Internal server error occurred",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(startTask("job-123", "research")).rejects.toEqual({
      code: "internal_error",
      message: "Internal server error",
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

    await expect(startTask("test-job", "research")).rejects.toEqual({
      code: "job_not_found",
      message: "Job not found.",
      status: 404,
    });
  });

  it("should handle network errors", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    await expect(startTask("test-job", "research")).rejects.toEqual({
      code: "network_error",
      message: "Network error",
    });
  });

  it("should handle network errors without message", async () => {
    const error = new Error();
    error.message = undefined;
    fetchMock.mockRejectedValue(error);

    await expect(startTask("test-job", "research")).rejects.toEqual({
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

    await expect(startTask("test-job", "research")).rejects.toEqual({
      code: "some_other_error",
      message: "Some other error message",
      status: 409,
    });
  });

  it("should fall back to default error message for unknown status codes", async () => {
    const mockResponse = {
      ok: false,
      status: 418,
      json: vi.fn().mockResolvedValue({
        ok: false,
        message: "I'm a teapot",
      }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    await expect(startTask("test-job", "research")).rejects.toEqual({
      code: "unknown_error",
      message: "I'm a teapot",
      status: 418,
    });
  });
});
