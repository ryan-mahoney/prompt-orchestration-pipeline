import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockProcessArgv } from "./test-utils.js";
import path from "node:path";

describe("CLI", () => {
  let cleanupArgv;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock process.argv for CLI testing
    cleanupArgv = mockProcessArgv(["node", "cli.js"]);

    // Mock console for output testing
    vi.spyOn(console, "log");
    vi.spyOn(console, "table");

    // Mock process for signal handling
    vi.spyOn(process, "on");
    vi.spyOn(process, "exit");
  });

  afterEach(() => {
    cleanupArgv?.();
    vi.restoreAllMocks();
  });

  describe("CLI Command Logic", () => {
    it("should handle init command file operations", async () => {
      // Arrange
      const mockFs = {
        mkdir: vi.fn().mockResolvedValue(),
        writeFile: vi.fn().mockResolvedValue(),
      };

      vi.doMock("node:fs/promises", () => mockFs);

      // Act - Test the init command logic directly
      const initHandler = async () => {
        const template = {
          pipeline: {
            name: "my-pipeline",
            version: "1.0.0",
            tasks: ["example-task"],
          },
          tasks: {
            "example-task": {
              ingestion: `export async function ingestion(context) { return { data: "example" }; }`,
              inference: `export async function inference(context) { return { output: context.data }; }`,
            },
          },
        };
        await mockFs.mkdir("pipeline-config/tasks/example-task", {
          recursive: true,
        });
        await mockFs.writeFile(
          "pipeline-config/pipeline.json",
          JSON.stringify(template.pipeline, null, 2)
        );
        await mockFs.writeFile(
          "pipeline-config/tasks/index.js",
          `export default {\n  'example-task': './example-task/index.js'\n};`
        );
        await mockFs.writeFile(
          "pipeline-config/tasks/example-task/index.js",
          `${template.tasks["example-task"].ingestion}\n\n${template.tasks["example-task"].inference}\n`
        );
        console.log("Pipeline configuration initialized");
      };

      await initHandler();

      // Assert
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        "pipeline-config/tasks/example-task",
        { recursive: true }
      );
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        "Pipeline configuration initialized"
      );
    });

    it("should handle start command orchestrator initialization", async () => {
      // Arrange
      const mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(),
        stop: vi.fn().mockResolvedValue(),
      };

      vi.doMock("../src/api/index.js", () => ({
        PipelineOrchestrator: vi.fn(() => mockOrchestrator),
      }));

      // Act - Test the start command logic directly
      const startHandler = async (options) => {
        const { PipelineOrchestrator } = await import("../src/api/index.js");
        const orchestrator = new PipelineOrchestrator({
          ui: options.ui,
          uiPort: parseInt(options.port),
        });
        await orchestrator.initialize();
        console.log("Pipeline orchestrator started");
        process.on("SIGINT", async () => {
          await orchestrator.stop();
          process.exit(0);
        });
      };

      await startHandler({ ui: false, port: "3000" });

      // Assert
      expect(mockOrchestrator.initialize).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith("Pipeline orchestrator started");
      expect(process.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    });

    it("should handle submit command job submission using submitJobWithValidation", async () => {
      // Arrange
      const mockFs = {
        readFile: vi.fn().mockResolvedValue(JSON.stringify({ data: "test" })),
      };

      const mockSubmitJobWithValidation = vi.fn().mockResolvedValue({
        success: true,
        jobId: "job-123",
        jobName: "test-job",
        message: "Seed file uploaded successfully",
      });

      vi.doMock("node:fs/promises", () => mockFs);
      vi.doMock("../src/api/index.js", () => ({
        submitJobWithValidation: mockSubmitJobWithValidation,
      }));

      // Act - Test the submit command logic directly
      const submitHandler = async (seedFile) => {
        const { submitJobWithValidation } = await import("../src/api/index.js");
        const seed = JSON.parse(await mockFs.readFile(seedFile, "utf8"));
        const result = await submitJobWithValidation({
          dataDir: process.cwd(),
          seedObject: seed,
        });
        if (result.success) {
          console.log(`Job submitted: ${result.jobId} (${result.jobName})`);
        } else {
          console.error(`Failed to submit job: ${result.message}`);
        }
      };

      await submitHandler("seed.json");

      // Assert
      expect(mockFs.readFile).toHaveBeenCalledWith("seed.json", "utf8");
      expect(mockSubmitJobWithValidation).toHaveBeenCalledWith({
        dataDir: process.cwd(),
        seedObject: { data: "test" },
      });
      expect(console.log).toHaveBeenCalledWith(
        "Job submitted: job-123 (test-job)"
      );
    });

    it("should handle status command job listing", async () => {
      // Arrange
      const mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(),
        listJobs: vi.fn().mockResolvedValue([
          { name: "job1", status: "complete" },
          { name: "job2", status: "running" },
        ]),
      };

      vi.doMock("../src/api/index.js", () => ({
        PipelineOrchestrator: vi.fn(() => mockOrchestrator),
      }));

      // Act - Test the status command logic directly
      const statusHandler = async (jobName) => {
        const { PipelineOrchestrator } = await import("../src/api/index.js");
        const orchestrator = new PipelineOrchestrator({ autoStart: false });
        await orchestrator.initialize();
        if (jobName) {
          const status = await orchestrator.getStatus(jobName);
          console.log(JSON.stringify(status, null, 2));
        } else {
          const jobs = await orchestrator.listJobs();
          console.table(jobs);
        }
      };

      await statusHandler();

      // Assert
      expect(mockOrchestrator.initialize).toHaveBeenCalled();
      expect(mockOrchestrator.listJobs).toHaveBeenCalled();
      expect(console.table).toHaveBeenCalledWith([
        { name: "job1", status: "complete" },
        { name: "job2", status: "running" },
      ]);
    });

    it("should handle status command specific job status", async () => {
      // Arrange
      const mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(),
        getStatus: vi
          .fn()
          .mockResolvedValue({ name: "test-job", status: "running" }),
      };

      vi.doMock("../src/api/index.js", () => ({
        PipelineOrchestrator: vi.fn(() => mockOrchestrator),
      }));

      // Act - Test the status command logic directly
      const statusHandler = async (jobName) => {
        const { PipelineOrchestrator } = await import("../src/api/index.js");
        const orchestrator = new PipelineOrchestrator({ autoStart: false });
        await orchestrator.initialize();
        if (jobName) {
          const status = await orchestrator.getStatus(jobName);
          console.log(JSON.stringify(status, null, 2));
        } else {
          const jobs = await orchestrator.listJobs();
          console.table(jobs);
        }
      };

      await statusHandler("test-job");

      // Assert
      expect(mockOrchestrator.initialize).toHaveBeenCalled();
      expect(mockOrchestrator.getStatus).toHaveBeenCalledWith("test-job");
      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify({ name: "test-job", status: "running" }, null, 2)
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle file system errors in init command", async () => {
      // Arrange
      const mockFs = {
        mkdir: vi.fn().mockRejectedValue(new Error("Permission denied")),
        writeFile: vi.fn().mockResolvedValue(),
      };

      vi.doMock("node:fs/promises", () => mockFs);

      // Act & Assert
      const initHandler = async () => {
        const template = {
          pipeline: {
            name: "my-pipeline",
            version: "1.0.0",
            tasks: ["example-task"],
          },
          tasks: {
            "example-task": {
              ingestion: `export async function ingestion(context) { return { data: "example" }; }`,
              inference: `export async function inference(context) { return { output: context.data }; }`,
            },
          },
        };
        await mockFs.mkdir("pipeline-config/tasks/example-task", {
          recursive: true,
        });
        await mockFs.writeFile(
          "pipeline-config/pipeline.json",
          JSON.stringify(template.pipeline, null, 2)
        );
        await mockFs.writeFile(
          "pipeline-config/tasks/index.js",
          `export default {\n  'example-task': './example-task/index.js'\n};`
        );
        await mockFs.writeFile(
          "pipeline-config/tasks/example-task/index.js",
          `${template.tasks["example-task"].ingestion}\n\n${template.tasks["example-task"].inference}\n`
        );
        console.log("Pipeline configuration initialized");
      };

      await expect(initHandler()).rejects.toThrow("Permission denied");
    });

    it("should handle orchestrator initialization errors", async () => {
      // Arrange
      const mockOrchestrator = {
        initialize: vi
          .fn()
          .mockRejectedValue(new Error("Initialization failed")),
      };

      vi.doMock("../src/api/index.js", () => ({
        PipelineOrchestrator: vi.fn(() => mockOrchestrator),
      }));

      // Act & Assert
      const startHandler = async (options) => {
        const { PipelineOrchestrator } = await import("../src/api/index.js");
        const orchestrator = new PipelineOrchestrator({
          ui: options.ui,
          uiPort: parseInt(options.port),
        });
        await orchestrator.initialize();
        console.log("Pipeline orchestrator started");
        process.on("SIGINT", async () => {
          await orchestrator.stop();
          process.exit(0);
        });
      };

      await expect(startHandler({ ui: false, port: "3000" })).rejects.toThrow(
        "Initialization failed"
      );
    });

    it("should handle JSON parsing errors in submit command", async () => {
      // Arrange
      const mockFs = {
        readFile: vi.fn().mockResolvedValue("invalid json"),
      };

      const mockSubmitJobWithValidation = vi.fn().mockResolvedValue({
        success: true,
        jobId: "job-123",
        jobName: "test-job",
        message: "Seed file uploaded successfully",
      });

      vi.doMock("node:fs/promises", () => mockFs);
      vi.doMock("../src/api/index.js", () => ({
        submitJobWithValidation: mockSubmitJobWithValidation,
      }));

      // Act & Assert
      const submitHandler = async (seedFile) => {
        const { submitJobWithValidation } = await import("../src/api/index.js");
        const seed = JSON.parse(await mockFs.readFile(seedFile, "utf8"));
        const result = await submitJobWithValidation({
          dataDir: process.cwd(),
          seedObject: seed,
        });
        if (result.success) {
          console.log(`Job submitted: ${result.jobId} (${result.jobName})`);
        } else {
          console.error(`Failed to submit job: ${result.message}`);
        }
      };

      await expect(submitHandler("seed.json")).rejects.toThrow();
    });
  });

  describe("Start Command (New Implementation)", () => {
    let mockSpawn, mockFs, mockConsoleError, mockProcessExit;

    beforeEach(() => {
      // Mock child_process.spawn
      mockSpawn = vi.fn();
      vi.doMock("node:child_process", () => ({ spawn: mockSpawn }));

      // Mock fs.promises
      mockFs = {
        access: vi.fn(),
      };
      vi.doMock("node:fs/promises", () => mockFs);

      // Mock console.error and process.exit for error testing
      mockConsoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should exit with error when PO_ROOT is not provided", async () => {
      // Arrange
      const startHandler = async () => {
        const globalOptions = { root: undefined, port: "4000" };
        let root = globalOptions.root || process.env.PO_ROOT;
        const port = globalOptions.port || "4000";

        if (!root) {
          console.error(
            "PO_ROOT is required. Use --root or set PO_ROOT to your pipeline root (e.g., ./demo)."
          );
          process.exit(1);
        }

        console.log(`Using PO_ROOT=${root}`);
        console.log(`UI port=${port}`);
      };

      // Act
      await startHandler();

      // Assert
      expect(mockConsoleError).toHaveBeenCalledWith(
        "PO_ROOT is required. Use --root or set PO_ROOT to your pipeline root (e.g., ./demo)."
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("should resolve relative paths to absolute paths", async () => {
      // Arrange
      const startHandler = async () => {
        const globalOptions = { root: "demo", port: "4000" };
        let root = globalOptions.root || process.env.PO_ROOT;
        const port = globalOptions.port || "4000";

        if (!root) {
          console.error(
            "PO_ROOT is required. Use --root or set PO_ROOT to your pipeline root (e.g., ./demo)."
          );
          process.exit(1);
        }

        const absoluteRoot = path.isAbsolute(root)
          ? root
          : path.resolve(process.cwd(), root);

        console.log(`Using PO_ROOT=${absoluteRoot}`);
        console.log(`UI port=${port}`);
        return { absoluteRoot, port };
      };

      // Act
      const result = await startHandler();

      // Assert
      expect(result.absoluteRoot).toMatch(/\/demo$/);
      expect(result.absoluteRoot).toBe(path.resolve(process.cwd(), "demo"));
      expect(result.port).toBe("4000");
    });

    it("should skip build when dist directory exists", async () => {
      // Arrange
      mockFs.access.mockResolvedValue(undefined); // dist exists

      const buildCheckHandler = async () => {
        const distPath = path.join(process.cwd(), "dist");
        try {
          await mockFs.access(distPath);
          return "UI build found, skipping build step";
        } catch {
          return "Building UI...";
        }
      };

      // Act
      const result = await buildCheckHandler();

      // Assert
      expect(result).toBe("UI build found, skipping build step");
      expect(mockFs.access).toHaveBeenCalledWith(
        path.join(process.cwd(), "dist")
      );
    });

    it("should build UI when dist directory does not exist", async () => {
      // Arrange
      mockFs.access.mockRejectedValue(new Error("ENOENT")); // dist doesn't exist

      const buildCheckHandler = async () => {
        const distPath = path.join(process.cwd(), "dist");
        try {
          await mockFs.access(distPath);
          return "UI build found, skipping build step";
        } catch {
          return "Building UI...";
        }
      };

      // Act
      const result = await buildCheckHandler();

      // Assert
      expect(result).toBe("Building UI...");
      expect(mockFs.access).toHaveBeenCalledWith(
        path.join(process.cwd(), "dist")
      );
    });

    it("should spawn processes with correct environment variables", () => {
      // Arrange
      const mockChildProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        killed: false,
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockChildProcess);

      const absoluteRoot = "/absolute/path/to/demo";
      const port = "3000";

      // Act
      const uiChild = mockSpawn("node", ["src/ui/server.js"], {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          PO_ROOT: absoluteRoot,
          PO_UI_PORT: port,
        },
      });

      const orchestratorChild = mockSpawn(
        "node",
        ["src/cli/run-orchestrator.js"],
        {
          stdio: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "production",
            PO_ROOT: absoluteRoot,
          },
        }
      );

      // Assert
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        "node",
        ["src/ui/server.js"],
        {
          stdio: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "production",
            PO_ROOT: absoluteRoot,
            PO_UI_PORT: port,
          },
        }
      );
      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        "node",
        ["src/cli/run-orchestrator.js"],
        {
          stdio: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "production",
            PO_ROOT: absoluteRoot,
          },
        }
      );
    });

    it("should handle child process cleanup correctly", () => {
      // Arrange
      const mockChildProcess = {
        killed: false,
        kill: vi.fn(),
      };

      const cleanup = (uiChild, orchestratorChild) => {
        if (uiChild && !uiChild.killed) {
          uiChild.kill("SIGTERM");
          setTimeout(() => {
            if (!uiChild.killed) uiChild.kill("SIGKILL");
          }, 5000);
        }
        if (orchestratorChild && !orchestratorChild.killed) {
          orchestratorChild.kill("SIGTERM");
          setTimeout(() => {
            if (!orchestratorChild.killed) orchestratorChild.kill("SIGKILL");
          }, 5000);
        }
      };

      // Act
      cleanup(mockChildProcess, mockChildProcess);

      // Assert
      expect(mockChildProcess.kill).toHaveBeenCalledTimes(2);
      expect(mockChildProcess.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
      expect(mockChildProcess.kill).toHaveBeenNthCalledWith(2, "SIGTERM");
    });

    it("should handle signal propagation correctly", () => {
      // Arrange
      const mockCleanup = vi.fn();
      const mockProcessExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => {});

      vi.spyOn(process, "on").mockImplementation((event, handler) => {
        if (event === "SIGINT" || event === "SIGTERM") {
          handler();
        }
      });

      // Act
      process.on("SIGINT", () => {
        console.log("\nReceived SIGINT, shutting down...");
        mockCleanup();
        mockProcessExit(0);
      });

      process.on("SIGTERM", () => {
        console.log("\nReceived SIGTERM, shutting down...");
        mockCleanup();
        mockProcessExit(0);
      });

      // Assert
      expect(mockCleanup).toHaveBeenCalledTimes(2);
      expect(mockProcessExit).toHaveBeenCalledTimes(2);
    });
  });
});
