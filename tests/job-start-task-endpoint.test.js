import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTaskStart } from "../src/ui/endpoints/job-control-endpoints.js";
import {
  getJobDirectoryPath,
  getJobPipelinePath,
} from "../src/config/paths.js";
import { spawn } from "node:child_process";

// Mock modules
vi.mock("../src/config/paths.js", () => ({
  getJobDirectoryPath: vi.fn(),
  getJobPipelinePath: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", async () => ({
  promises: {
    access: vi.fn(),
    readFile: vi.fn(),
  },
}));

describe("handleTaskStart", () => {
  let mockReq;
  let mockRes;
  let mockDataDir;
  let mockSendJson;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: 200,
      json: vi.fn(),
    };
    mockDataDir = "/test/data";
    mockSendJson = vi.fn();

    // Reset all mocks
    vi.clearAllMocks();

    // Mock console methods to avoid noise in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Validation cases", () => {
    it("should return 400 when jobId is empty", async () => {
      await handleTaskStart(
        mockReq,
        mockRes,
        "",
        "test-task",
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 400, {
        ok: false,
        error: "bad_request",
        message: "jobId is required",
      });
    });

    it("should return 400 when taskId is empty", async () => {
      await handleTaskStart(
        mockReq,
        mockRes,
        "test-job",
        "",
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 400, {
        ok: false,
        error: "bad_request",
        message: "taskId is required",
      });
    });
  });

  describe("Error handling", () => {
    it("should return 500 for invalid JSON in tasks-status.json", async () => {
      const jobId = "test-job";
      const taskId = "test-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue("/test/data/current/test-job");
      getJobPipelinePath.mockReturnValue(
        "/test/data/current/test-job/pipeline.json"
      );

      promises.readFile.mockResolvedValue("invalid json content");

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 500, {
        ok: false,
        code: "internal_error",
        message: "Invalid job status JSON",
      });
    });

    it("should return 404 for ENOENT when reading tasks-status.json", async () => {
      const jobId = "test-job";
      const taskId = "test-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue("/test/data/current/test-job");

      const error = new Error("ENOENT: no such file");
      error.code = "ENOENT";
      promises.readFile.mockRejectedValue(error);

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job status file not found",
      });
    });
  });

  describe("Job lifecycle cases", () => {
    it("should return 404 when job directory not found", async () => {
      const jobId = "nonexistent-job";
      const taskId = "test-task";

      // Mock directory doesn't exist
      const { promises } = await import("node:fs");
      promises.access.mockRejectedValue(new Error("ENOENT"));

      getJobDirectoryPath.mockReturnValue("/test/data/current/nonexistent-job");

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 404, {
        ok: false,
        code: "job_not_found",
        message: "Job not found",
      });
    });

    it("should return 409 when job is in complete lifecycle", async () => {
      const jobId = "complete-job";
      const taskId = "test-task";

      // Mock current directory doesn't exist but complete does
      const { promises } = await import("node:fs");
      promises.access
        .mockResolvedValueOnce(undefined) // complete dir exists
        .mockRejectedValueOnce(new Error("ENOENT")); // current dir doesn't exist

      getJobDirectoryPath
        .mockReturnValueOnce("/test/data/current/complete-job")
        .mockReturnValueOnce("/test/data/complete/complete-job");

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 409, {
        ok: false,
        code: "unsupported_lifecycle",
        message: "Job must be in current to start a task",
      });
    });
  });

  describe("Task state cases", () => {
    it("should return 409 when job is running", async () => {
      const jobId = "running-job";
      const taskId = "test-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue("/test/data/current/running-job");

      const mockSnapshot = {
        state: "running",
        tasks: {
          "test-task": {
            state: "pending",
            currentStage: null,
            attempts: 0,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
        },
      };

      promises.readFile.mockResolvedValue(JSON.stringify(mockSnapshot));

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 409, {
        ok: false,
        code: "job_running",
        message: "Job is currently running; start is unavailable",
      });
    });

    it("should return 409 when any task is running", async () => {
      const jobId = "job-with-running-task";
      const taskId = "test-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue(
        "/test/data/current/job-with-running-task"
      );

      const mockSnapshot = {
        state: "idle",
        tasks: {
          "test-task": {
            state: "pending",
            currentStage: null,
            attempts: 0,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
          "other-task": {
            state: "running",
            currentStage: "processing",
            attempts: 1,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
        },
      };

      promises.readFile.mockResolvedValue(JSON.stringify(mockSnapshot));

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 409, {
        ok: false,
        code: "job_running",
        message: "Job is currently running; start is unavailable",
      });
    });

    it("should return 400 when task not found", async () => {
      const jobId = "test-job";
      const taskId = "nonexistent-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue("/test/data/current/test-job");

      const mockSnapshot = {
        state: "idle",
        tasks: {
          "other-task": {
            state: "pending",
            currentStage: null,
            attempts: 0,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
        },
      };

      promises.readFile.mockResolvedValue(JSON.stringify(mockSnapshot));

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 400, {
        ok: false,
        code: "task_not_found",
        message: "Task not found in job",
      });
    });

    it("should return 400 when task is not pending", async () => {
      const jobId = "test-job";
      const taskId = "done-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue("/test/data/current/test-job");

      const mockSnapshot = {
        state: "idle",
        tasks: {
          "done-task": {
            state: "done",
            currentStage: null,
            attempts: 1,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
        },
      };

      promises.readFile.mockResolvedValue(JSON.stringify(mockSnapshot));

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 400, {
        ok: false,
        code: "task_not_pending",
        message: "Task is not in pending state",
      });
    });
  });

  describe("Pipeline config cases", () => {
    it("should return 500 when pipeline config not found", async () => {
      const jobId = "test-job";
      const taskId = "test-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue("/test/data/current/test-job");
      getJobPipelinePath.mockReturnValue(
        "/test/data/current/test-job/pipeline.json"
      );

      const mockSnapshot = {
        state: "idle",
        tasks: {
          "test-task": {
            state: "pending",
            currentStage: null,
            attempts: 0,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
        },
      };

      promises.readFile.mockImplementation((path) => {
        if (path.endsWith("tasks-status.json")) {
          return Promise.resolve(JSON.stringify(mockSnapshot));
        }
        if (path.endsWith("pipeline.json")) {
          return Promise.reject(new Error("ENOENT: no such file"));
        }
        return Promise.reject(new Error("Unexpected file read"));
      });

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 500, {
        ok: false,
        code: "pipeline_config_not_found",
        message: "Pipeline configuration not found",
      });
    });

    it("should return 409 when dependencies not satisfied", async () => {
      const jobId = "test-job";
      const taskId = "test-task";

      // Mock directory exists
      const { promises } = await import("node:fs");
      promises.access.mockResolvedValue(undefined);

      getJobDirectoryPath.mockReturnValue("/test/data/current/test-job");
      getJobPipelinePath.mockReturnValue(
        "/test/data/current/test-job/pipeline.json"
      );

      const mockSnapshot = {
        state: "idle",
        tasks: {
          "upstream-task": {
            state: "pending", // Not done - this should cause dependency failure
            currentStage: null,
            attempts: 0,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
          "test-task": {
            state: "pending",
            currentStage: null,
            attempts: 0,
            refinementAttempts: 0,
            files: {
              artifacts: [],
              logs: [],
              tmp: [],
            },
          },
        },
      };

      const mockPipeline = {
        tasks: ["upstream-task", "test-task", "downstream-task"],
      };

      promises.readFile.mockImplementation((filePath) => {
        if (filePath.endsWith("tasks-status.json")) {
          return Promise.resolve(JSON.stringify(mockSnapshot));
        }
        if (filePath.endsWith("pipeline.json")) {
          return Promise.resolve(JSON.stringify(mockPipeline));
        }
        return Promise.reject(new Error("Unexpected file read"));
      });

      await handleTaskStart(
        mockReq,
        mockRes,
        jobId,
        taskId,
        mockDataDir,
        mockSendJson
      );

      expect(mockSendJson).toHaveBeenCalledWith(mockRes, 409, {
        ok: false,
        code: "dependencies_not_satisfied",
        message: "Dependencies not satisfied for task: upstream-task",
      });
    });
  });
});
