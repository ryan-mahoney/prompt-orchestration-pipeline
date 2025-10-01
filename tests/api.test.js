import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";

// Mock the orchestrator module at the top level
vi.mock("../src/core/orchestrator.js", () => ({
  Orchestrator: vi.fn(),
}));

// Mock the UI server module at the top level
vi.mock("../src/ui/server.js", () => ({
  createUIServer: vi.fn(),
}));

describe("API Module", () => {
  let apiModule;
  let mockOrchestrator;
  let mockUIServer;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create fresh mock instances
    mockOrchestrator = {
      start: vi.fn().mockResolvedValue(),
      stop: vi.fn().mockResolvedValue(),
    };

    mockUIServer = {
      listen: vi.fn((port, callback) => {
        callback?.();
        return { close: vi.fn() };
      }),
    };

    // Setup mock implementations
    const { Orchestrator } = await import("../src/core/orchestrator.js");
    const { createUIServer } = await import("../src/ui/server.js");

    Orchestrator.mockImplementation(() => mockOrchestrator);
    createUIServer.mockImplementation(() => mockUIServer);

    // Import the API module after mocks are set up
    apiModule = await import("../src/api/index.js");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createPipelineOrchestrator", () => {
    it("should create orchestrator with default config", async () => {
      // Arrange
      vi.spyOn(fs, "mkdir").mockResolvedValue();
      vi.spyOn(fs, "readFile").mockResolvedValue(
        JSON.stringify({ tasks: ["test-task"] })
      );

      // Act
      const state = await apiModule.createPipelineOrchestrator();

      // Assert
      expect(state.config.rootDir).toBe(process.cwd());
      expect(state.config.autoStart).toBe(true);
      expect(state.config.ui).toBe(false);
      expect(state.orchestrator).toBe(mockOrchestrator);
      expect(mockOrchestrator.start).toHaveBeenCalled(); // auto-start enabled by default
    });

    it("should create orchestrator with custom config", async () => {
      // Arrange
      vi.spyOn(fs, "mkdir").mockResolvedValue();
      vi.spyOn(fs, "readFile").mockResolvedValue(
        JSON.stringify({ tasks: ["test-task"] })
      );

      const customOptions = {
        rootDir: "/custom",
        dataDir: "my-data",
        configDir: "my-config",
        autoStart: false,
      };

      // Act
      const state = await apiModule.createPipelineOrchestrator(customOptions);

      // Assert
      expect(state.config.rootDir).toBe("/custom");
      expect(state.config.dataDir).toBe("my-data");
      expect(state.config.configDir).toBe("my-config");
      expect(state.config.autoStart).toBe(false);
      expect(mockOrchestrator.start).not.toHaveBeenCalled(); // auto-start disabled
    });

    it("should start UI server when configured", async () => {
      // Arrange
      vi.spyOn(fs, "mkdir").mockResolvedValue();
      vi.spyOn(fs, "readFile").mockResolvedValue(
        JSON.stringify({ tasks: ["test-task"] })
      );

      // Act
      await apiModule.createPipelineOrchestrator({ ui: true, uiPort: 8080 });

      // Assert
      expect(mockUIServer.listen).toHaveBeenCalledWith(
        8080,
        expect.any(Function)
      );
    });

    it("should not start UI server when disabled", async () => {
      // Arrange
      vi.spyOn(fs, "mkdir").mockResolvedValue();
      vi.spyOn(fs, "readFile").mockResolvedValue(
        JSON.stringify({ tasks: ["test-task"] })
      );

      // Act
      await apiModule.createPipelineOrchestrator({ ui: false });

      // Assert
      expect(mockUIServer.listen).not.toHaveBeenCalled();
    });
  });

  describe("submitJob", () => {
    it("should submit job with custom name", async () => {
      // Arrange
      vi.spyOn(fs, "writeFile").mockResolvedValue();

      const state = {
        paths: { pending: "/test/pending" },
      };
      const seed = { name: "custom-job", data: { test: "value" } };

      // Act
      const result = await apiModule.submitJob(state, seed);

      // Assert
      expect(result.name).toBe("custom-job");
      expect(result.seedPath).toBe("/test/pending/custom-job-seed.json");
      expect(fs.writeFile).toHaveBeenCalledWith(
        "/test/pending/custom-job-seed.json",
        JSON.stringify(seed, null, 2)
      );
    });

    it("should submit job with provided name", async () => {
      // Arrange
      vi.spyOn(fs, "writeFile").mockResolvedValue();

      const state = {
        paths: { pending: "/test/pending" },
      };
      const seed = { name: "test-job", data: { test: "value" } };

      // Act
      const result = await apiModule.submitJob(state, seed);

      // Assert
      expect(result.name).toBe("test-job");
      expect(result.seedPath).toBe("/test/pending/test-job-seed.json");
    });
  });

  describe("getStatus", () => {
    it("should get status from current directory", async () => {
      // Arrange
      const statusData = { status: "running", progress: 50 };
      vi.spyOn(fs, "readFile").mockResolvedValueOnce(
        JSON.stringify(statusData)
      );

      const state = {
        paths: {
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.getStatus(state, "test-job");

      // Assert
      expect(result).toEqual(statusData);
      expect(fs.readFile).toHaveBeenCalledWith(
        "/test/current/test-job/tasks-status.json",
        "utf8"
      );
    });

    it("should get status from complete directory", async () => {
      // Arrange
      const statusData = { status: "complete", result: "success" };
      vi.spyOn(fs, "readFile")
        .mockRejectedValueOnce(new Error("Not found"))
        .mockResolvedValueOnce(JSON.stringify(statusData));

      const state = {
        paths: {
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.getStatus(state, "test-job");

      // Assert
      expect(result).toEqual(statusData);
      expect(fs.readFile).toHaveBeenCalledWith(
        "/test/complete/test-job/tasks-status.json",
        "utf8"
      );
    });

    it("should return null for non-existent job", async () => {
      // Arrange
      vi.spyOn(fs, "readFile")
        .mockRejectedValueOnce(new Error("Not found"))
        .mockRejectedValueOnce(new Error("Not found"));

      const state = {
        paths: {
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.getStatus(state, "non-existent-job");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("listJobs", () => {
    it("should list pending jobs", async () => {
      // Arrange
      vi.spyOn(fs, "readdir")
        .mockResolvedValueOnce(["job1-seed.json", "job2-seed.json"]) // pending
        .mockRejectedValueOnce(new Error("Not found")) // current
        .mockRejectedValueOnce(new Error("Not found")); // complete

      const state = {
        paths: {
          pending: "/test/pending",
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.listJobs(state, "pending");

      // Assert
      expect(result).toEqual([
        { name: "job1", status: "pending" },
        { name: "job2", status: "pending" },
      ]);
    });

    it("should list current jobs", async () => {
      // Arrange
      const readdirSpy = vi.spyOn(fs, "readdir");
      // Only mock the current directory since we're filtering by status
      readdirSpy.mockResolvedValueOnce(["job3", "job4"]); // current

      const state = {
        paths: {
          pending: "/test/pending",
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.listJobs(state, "current");

      // Assert
      expect(result).toEqual([
        { name: "job3", status: "current" },
        { name: "job4", status: "current" },
      ]);
    });

    it("should list complete jobs", async () => {
      // Arrange
      const readdirSpy = vi.spyOn(fs, "readdir");
      // Only mock the complete directory since we're filtering by status
      readdirSpy.mockResolvedValueOnce(["job5", "job6"]); // complete

      const state = {
        paths: {
          pending: "/test/pending",
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.listJobs(state, "complete");

      // Assert
      expect(result).toEqual([
        { name: "job5", status: "complete" },
        { name: "job6", status: "complete" },
      ]);
    });

    it("should list all jobs", async () => {
      // Arrange
      vi.spyOn(fs, "readdir")
        .mockResolvedValueOnce(["job1-seed.json"]) // pending
        .mockResolvedValueOnce(["job2"]) // current
        .mockResolvedValueOnce(["job3"]); // complete

      const state = {
        paths: {
          pending: "/test/pending",
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.listJobs(state, "all");

      // Assert
      expect(result).toEqual([
        { name: "job1", status: "pending" },
        { name: "job2", status: "current" },
        { name: "job3", status: "complete" },
      ]);
    });

    it("should handle empty directories gracefully", async () => {
      // Arrange
      vi.spyOn(fs, "readdir")
        .mockRejectedValueOnce(new Error("Not found")) // pending
        .mockRejectedValueOnce(new Error("Not found")) // current
        .mockRejectedValueOnce(new Error("Not found")); // complete

      const state = {
        paths: {
          pending: "/test/pending",
          current: "/test/current",
          complete: "/test/complete",
        },
      };

      // Act
      const result = await apiModule.listJobs(state, "all");

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe("start", () => {
    it("should start orchestrator", async () => {
      // Arrange
      const mockStart = vi.fn().mockResolvedValue();
      const state = {
        orchestrator: { start: mockStart },
      };

      // Act
      const result = await apiModule.start(state);

      // Assert
      expect(mockStart).toHaveBeenCalled();
      expect(result).toBe(state);
    });
  });

  describe("stop", () => {
    it("should stop orchestrator and UI server", async () => {
      // Arrange
      const mockStop = vi.fn().mockResolvedValue();
      const mockClose = vi.fn((cb) => cb());
      const mockServer = { close: mockClose };
      const state = {
        orchestrator: { stop: mockStop },
        uiServer: mockServer,
      };

      // Act
      const result = await apiModule.stop(state);

      // Assert
      expect(mockStop).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(result).toBe(state);
    });

    it("should handle stop without UI server", async () => {
      // Arrange
      const mockStop = vi.fn().mockResolvedValue();
      const state = {
        orchestrator: { stop: mockStop },
        uiServer: null,
      };

      // Act
      const result = await apiModule.stop(state);

      // Assert
      expect(mockStop).toHaveBeenCalled();
      expect(result).toBe(state);
    });
  });

  describe("Backward Compatibility", () => {
    describe("PipelineOrchestrator.create", () => {
      it("should create PipelineOrchestrator instance", async () => {
        // Arrange
        vi.spyOn(fs, "mkdir").mockResolvedValue();
        vi.spyOn(fs, "readFile").mockResolvedValue(
          JSON.stringify({ tasks: ["test-task"] })
        );

        // Act
        const instance = await apiModule.PipelineOrchestrator.create();

        // Assert
        expect(instance.config).toBeDefined();
        expect(instance.paths).toBeDefined();
        expect(instance.start).toBeInstanceOf(Function);
        expect(instance.stop).toBeInstanceOf(Function);
        expect(instance.submitJob).toBeInstanceOf(Function);
        expect(instance.getStatus).toBeInstanceOf(Function);
        expect(instance.listJobs).toBeInstanceOf(Function);
      });

      it("should maintain state across method calls", async () => {
        // Arrange
        vi.spyOn(fs, "mkdir").mockResolvedValue();
        vi.spyOn(fs, "readFile")
          .mockResolvedValueOnce(JSON.stringify({ tasks: ["test-task"] })) // Pipeline config
          .mockRejectedValueOnce(new Error("Not found")) // Current directory status
          .mockRejectedValueOnce(new Error("Not found")); // Complete directory status
        vi.spyOn(fs, "writeFile").mockResolvedValue();
        vi.spyOn(fs, "readdir").mockResolvedValue([]); // Empty job list

        // Act
        const instance = await apiModule.PipelineOrchestrator.create();

        // Call multiple methods to verify state is maintained
        await instance.start();
        const jobResult = await instance.submitJob({
          name: "test-job",
          data: { test: "value" },
        });
        const status = await instance.getStatus("test-job");
        const jobs = await instance.listJobs();
        await instance.stop();

        // Assert
        expect(instance.config).toBeDefined();
        expect(instance.paths).toBeDefined();
        expect(jobResult.name).toBe("test-job");
        expect(status).toBeNull(); // Job not actually running in test
        expect(jobs).toEqual([]); // No jobs in test
      });
    });
  });
});
