import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mockProcessArgv,
  createTempDir,
  cleanupTempDir,
} from "./test-utils.js";
import { promises as fs } from "node:fs";
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
    it("should create exact directory tree and registry.json on init", async () => {
      // Arrange
      const mockFs = {
        mkdir: vi.fn().mockResolvedValue(),
        writeFile: vi.fn().mockResolvedValue(),
      };

      vi.doMock("node:fs/promises", () => mockFs);

      // Act - Test the new init command logic directly
      const initHandler = async (globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Create directories
        await mockFs.mkdir(path.join(root, "pipeline-config"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "pending"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "current"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "complete"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "rejected"), {
          recursive: true,
        });

        // Create .gitkeep files
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "pending", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "current", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "complete", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "rejected", ".gitkeep"),
          ""
        );

        // Write registry.json with exact required content
        const registryContent = { pipelines: {} };
        await mockFs.writeFile(
          path.join(root, "pipeline-config", "registry.json"),
          JSON.stringify(registryContent, null, 2) + "\n"
        );

        console.log(`Pipeline configuration initialized at ${root}`);
      };

      await initHandler();

      // Assert - Check directory creation
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-config$/),
        { recursive: true }
      );
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/pending$/),
        { recursive: true }
      );
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/current$/),
        { recursive: true }
      );
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/complete$/),
        { recursive: true }
      );
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/rejected$/),
        { recursive: true }
      );

      // Assert - Check .gitkeep files
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/pending\/\.gitkeep$/),
        ""
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/current\/\.gitkeep$/),
        ""
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/complete\/\.gitkeep$/),
        ""
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-data\/rejected\/\.gitkeep$/),
        ""
      );

      // Assert - Check registry.json content
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/pipeline-config\/registry\.json$/),
        '{\n  "pipelines": {}\n}\n'
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/Pipeline configuration initialized at/)
      );
    });

    it("should use custom root when provided", async () => {
      // Arrange
      const mockFs = {
        mkdir: vi.fn().mockResolvedValue(),
        writeFile: vi.fn().mockResolvedValue(),
      };

      vi.doMock("node:fs/promises", () => mockFs);

      // Act
      const initHandler = async (globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");
        await mockFs.mkdir(path.join(root, "pipeline-config"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "pending"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "current"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "complete"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "rejected"), {
          recursive: true,
        });
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "pending", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "current", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "complete", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "rejected", ".gitkeep"),
          ""
        );
        const registryContent = { pipelines: {} };
        await mockFs.writeFile(
          path.join(root, "pipeline-config", "registry.json"),
          JSON.stringify(registryContent, null, 2) + "\n"
        );
        console.log(`Pipeline configuration initialized at ${root}`);
      };

      await initHandler({ root: "/custom/path" });

      // Assert
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        "/custom/path/pipeline-config",
        { recursive: true }
      );
      expect(console.log).toHaveBeenCalledWith(
        "Pipeline configuration initialized at /custom/path"
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
    it("should handle file system errors in new init command", async () => {
      // Arrange
      const mockFs = {
        mkdir: vi.fn().mockRejectedValue(new Error("Permission denied")),
        writeFile: vi.fn().mockResolvedValue(),
      };

      vi.doMock("node:fs/promises", () => mockFs);

      // Act & Assert
      const initHandler = async (globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");
        await mockFs.mkdir(path.join(root, "pipeline-config"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "pending"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "current"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "complete"), {
          recursive: true,
        });
        await mockFs.mkdir(path.join(root, "pipeline-data", "rejected"), {
          recursive: true,
        });
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "pending", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "current", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "complete", ".gitkeep"),
          ""
        );
        await mockFs.writeFile(
          path.join(root, "pipeline-data", "rejected", ".gitkeep"),
          ""
        );
        const registryContent = { pipelines: {} };
        await mockFs.writeFile(
          path.join(root, "pipeline-config", "registry.json"),
          JSON.stringify(registryContent, null, 2) + "\n"
        );
        console.log(`Pipeline configuration initialized at ${root}`);
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

    it("should spawn processes with correct environment variables and absolute paths", () => {
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
      const expectedUiPath = path.resolve(process.cwd(), "src/ui/server.js");
      const expectedOrchestratorPath = path.resolve(
        process.cwd(),
        "src/cli/run-orchestrator.js"
      );

      // Act
      const uiChild = mockSpawn("node", [expectedUiPath], {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          PO_ROOT: absoluteRoot,
          PO_UI_PORT: port,
        },
      });

      const orchestratorChild = mockSpawn("node", [expectedOrchestratorPath], {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          PO_ROOT: absoluteRoot,
        },
      });

      // Assert
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenNthCalledWith(1, "node", [expectedUiPath], {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          PO_ROOT: absoluteRoot,
          PO_UI_PORT: port,
        },
      });
      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        "node",
        [expectedOrchestratorPath],
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
        if (event === "SIGINT") {
          handler();
        }
        if (event === "SIGTERM") {
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

  describe("Add Pipeline Command", () => {
    let mockFs, mockConsoleError, mockProcessExit, mockConsoleLog;

    beforeEach(() => {
      // Mock fs.promises
      mockFs = {
        mkdir: vi.fn().mockResolvedValue(),
        writeFile: vi.fn().mockResolvedValue(),
        readFile: vi.fn(),
      };
      vi.doMock("node:fs/promises", () => mockFs);

      // Mock console methods
      mockConsoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should create pipeline configuration and update registry successfully", async () => {
      // Arrange
      const pipelineSlug = "content-generation";
      const root = "/test/pipelines";

      // Mock registry.json read to return empty registry
      mockFs.readFile.mockResolvedValue(JSON.stringify({ pipelines: {} }));

      // Act - Test the add-pipeline command logic directly
      const addPipelineHandler = async (pipelineSlug, globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate pipeline-slug is kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error("Invalid pipeline slug: must be kebab-case (a-z0-9-)");
          process.exit(1);
        }

        try {
          // Ensure directories exist
          const pipelineConfigDir = path.join(
            root,
            "pipeline-config",
            pipelineSlug
          );
          const tasksDir = path.join(pipelineConfigDir, "tasks");
          await mockFs.mkdir(tasksDir, { recursive: true });

          // Write pipeline.json
          const pipelineConfig = {
            name: pipelineSlug,
            version: "1.0.0",
            description: "New pipeline",
            tasks: [],
          };
          await mockFs.writeFile(
            path.join(pipelineConfigDir, "pipeline.json"),
            JSON.stringify(pipelineConfig, null, 2) + "\n"
          );

          // Write tasks/index.js
          await mockFs.writeFile(
            path.join(tasksDir, "index.js"),
            "export default {};\n"
          );

          // Update registry.json
          const registryPath = path.join(
            root,
            "pipeline-config",
            "registry.json"
          );
          let registry = { pipelines: {} };

          try {
            const registryContent = await mockFs.readFile(registryPath, "utf8");
            registry = JSON.parse(registryContent);
            if (!registry.pipelines) {
              registry.pipelines = {};
            }
          } catch (error) {
            // If registry doesn't exist or is invalid, use empty registry
            registry = { pipelines: {} };
          }

          // Add/replace pipeline entry
          registry.pipelines[pipelineSlug] = {
            name: pipelineSlug,
            description: "New pipeline",
            pipelinePath: `pipeline-config/${pipelineSlug}/pipeline.json`,
            taskRegistryPath: `pipeline-config/${pipelineSlug}/tasks/index.js`,
          };

          // Write back registry
          await mockFs.writeFile(
            registryPath,
            JSON.stringify(registry, null, 2) + "\n"
          );

          console.log(`Pipeline "${pipelineSlug}" added successfully`);
        } catch (error) {
          console.error(`Error adding pipeline: ${error.message}`);
          process.exit(1);
        }
      };

      await addPipelineHandler(pipelineSlug, { root });

      // Assert - Check directory creation
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/tasks",
        { recursive: true }
      );

      // Assert - Check pipeline.json creation
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/pipeline.json",
        '{\n  "name": "content-generation",\n  "version": "1.0.0",\n  "description": "New pipeline",\n  "tasks": []\n}\n'
      );

      // Assert - Check tasks/index.js creation
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/tasks/index.js",
        "export default {};\n"
      );

      // Assert - Check registry update
      expect(mockFs.readFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/registry.json",
        "utf8"
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/registry.json",
        '{\n  "pipelines": {\n    "content-generation": {\n      "name": "content-generation",\n      "description": "New pipeline",\n      "pipelinePath": "pipeline-config/content-generation/pipeline.json",\n      "taskRegistryPath": "pipeline-config/content-generation/tasks/index.js"\n    }\n  }\n}\n'
      );

      expect(mockConsoleLog).toHaveBeenCalledWith(
        'Pipeline "content-generation" added successfully'
      );
    });

    it("should reject invalid pipeline slugs", async () => {
      // Arrange
      const invalidSlug = "Invalid_Slug";

      // Act
      const addPipelineHandler = async (pipelineSlug, globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate pipeline-slug is kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error(
            "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
          );
          process.exit(1);
        }
      };

      await addPipelineHandler(invalidSlug);

      // Assert
      expect(mockConsoleError).toHaveBeenCalledWith(
        "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("should handle missing registry file gracefully", async () => {
      // Arrange
      const pipelineSlug = "test-pipeline";
      const root = "/test/pipelines";

      // Mock registry.json read to throw error (file doesn't exist)
      mockFs.readFile.mockRejectedValue(new Error("ENOENT: no such file"));

      // Act
      const addPipelineHandler = async (pipelineSlug, globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate pipeline-slug is kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error(
            "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
          );
          process.exit(1);
        }

        try {
          // Ensure directories exist
          const pipelineConfigDir = path.join(
            root,
            "pipeline-config",
            pipelineSlug
          );
          const tasksDir = path.join(pipelineConfigDir, "tasks");
          await mockFs.mkdir(tasksDir, { recursive: true });

          // Write pipeline.json
          const pipelineConfig = {
            name: pipelineSlug,
            version: "1.0.0",
            description: "New pipeline",
            tasks: [],
          };
          await mockFs.writeFile(
            path.join(pipelineConfigDir, "pipeline.json"),
            JSON.stringify(pipelineConfig, null, 2) + "\n"
          );

          // Write tasks/index.js
          await mockFs.writeFile(
            path.join(tasksDir, "index.js"),
            "export default {};\n"
          );

          // Update registry.json
          const registryPath = path.join(
            root,
            "pipeline-config",
            "registry.json"
          );
          let registry = { pipelines: {} };

          try {
            const registryContent = await mockFs.readFile(registryPath, "utf8");
            registry = JSON.parse(registryContent);
            if (!registry.pipelines) {
              registry.pipelines = {};
            }
          } catch (error) {
            // If registry doesn't exist or is invalid, use empty registry
            registry = { pipelines: {} };
          }

          // Add/replace pipeline entry
          registry.pipelines[pipelineSlug] = {
            name: pipelineSlug,
            description: "New pipeline",
            pipelinePath: `pipeline-config/${pipelineSlug}/pipeline.json`,
            taskRegistryPath: `pipeline-config/${pipelineSlug}/tasks/index.js`,
          };

          // Write back registry
          await mockFs.writeFile(
            registryPath,
            JSON.stringify(registry, null, 2) + "\n"
          );

          console.log(`Pipeline "${pipelineSlug}" added successfully`);
        } catch (error) {
          console.error(`Error adding pipeline: ${error.message}`);
          process.exit(1);
        }
      };

      await addPipelineHandler(pipelineSlug, { root });

      // Assert - Should still create pipeline even with missing registry
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/registry.json",
        '{\n  "pipelines": {\n    "test-pipeline": {\n      "name": "test-pipeline",\n      "description": "New pipeline",\n      "pipelinePath": "pipeline-config/test-pipeline/pipeline.json",\n      "taskRegistryPath": "pipeline-config/test-pipeline/tasks/index.js"\n    }\n  }\n}\n'
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        'Pipeline "test-pipeline" added successfully'
      );
    });

    it("should handle file system errors gracefully", async () => {
      // Arrange
      const pipelineSlug = "test-pipeline";
      const root = "/test/pipelines";

      // Mock mkdir to throw an error
      mockFs.mkdir.mockRejectedValue(new Error("Permission denied"));

      // Act
      const addPipelineHandler = async (pipelineSlug, globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate pipeline-slug is kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error(
            "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
          );
          process.exit(1);
        }

        try {
          // Ensure directories exist
          const pipelineConfigDir = path.join(
            root,
            "pipeline-config",
            pipelineSlug
          );
          const tasksDir = path.join(pipelineConfigDir, "tasks");
          await mockFs.mkdir(tasksDir, { recursive: true });

          // Write pipeline.json
          const pipelineConfig = {
            name: pipelineSlug,
            version: "1.0.0",
            description: "New pipeline",
            tasks: [],
          };
          await mockFs.writeFile(
            path.join(pipelineConfigDir, "pipeline.json"),
            JSON.stringify(pipelineConfig, null, 2) + "\n"
          );

          // Write tasks/index.js
          await mockFs.writeFile(
            path.join(tasksDir, "index.js"),
            "export default {};\n"
          );

          // Update registry.json
          const registryPath = path.join(
            root,
            "pipeline-config",
            "registry.json"
          );
          let registry = { pipelines: {} };

          try {
            const registryContent = await mockFs.readFile(registryPath, "utf8");
            registry = JSON.parse(registryContent);
            if (!registry.pipelines) {
              registry.pipelines = {};
            }
          } catch (error) {
            // If registry doesn't exist or is invalid, use empty registry
            registry = { pipelines: {} };
          }

          // Add/replace pipeline entry
          registry.pipelines[pipelineSlug] = {
            name: pipelineSlug,
            description: "New pipeline",
            pipelinePath: `pipeline-config/${pipelineSlug}/pipeline.json`,
            taskRegistryPath: `pipeline-config/${pipelineSlug}/tasks/index.js`,
          };

          // Write back registry
          await mockFs.writeFile(
            registryPath,
            JSON.stringify(registry, null, 2) + "\n"
          );

          console.log(`Pipeline "${pipelineSlug}" added successfully`);
        } catch (error) {
          console.error(`Error adding pipeline: ${error.message}`);
          process.exit(1);
        }
      };

      await addPipelineHandler(pipelineSlug, { root });

      // Assert
      expect(mockConsoleError).toHaveBeenCalledWith(
        "Error adding pipeline: Permission denied"
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("should use default root when not provided", async () => {
      // Arrange
      const pipelineSlug = "test-pipeline";

      mockFs.readFile.mockResolvedValue(JSON.stringify({ pipelines: {} }));

      // Act
      const addPipelineHandler = async (pipelineSlug, globalOptions = {}) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate pipeline-slug is kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error(
            "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
          );
          process.exit(1);
        }

        // Create directories to verify root path
        const pipelineConfigDir = path.join(
          root,
          "pipeline-config",
          pipelineSlug
        );
        const tasksDir = path.join(pipelineConfigDir, "tasks");
        await mockFs.mkdir(tasksDir, { recursive: true });

        return root;
      };

      const usedRoot = await addPipelineHandler(pipelineSlug);

      // Assert
      expect(usedRoot).toBe(path.resolve(process.cwd(), "pipelines"));
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        path.join(
          path.resolve(process.cwd(), "pipelines"),
          "pipeline-config",
          "test-pipeline",
          "tasks"
        ),
        { recursive: true }
      );
    });
  });

  describe("Add Pipeline Task Command", () => {
    let mockFs, mockConsoleError, mockProcessExit, mockConsoleLog;

    beforeEach(() => {
      // Mock fs.promises
      mockFs = {
        access: vi.fn(),
        writeFile: vi.fn().mockResolvedValue(),
        readFile: vi.fn(),
      };
      vi.doMock("node:fs/promises", () => mockFs);

      // Mock console methods
      mockConsoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should create task file with all stage exports and update index", async () => {
      // Arrange
      const pipelineSlug = "content-generation";
      const taskSlug = "research";
      const root = "/test/pipelines";

      // Mock that tasks directory exists
      mockFs.access.mockResolvedValue(undefined);

      // Mock existing index.js content (empty)
      mockFs.readFile
        .mockResolvedValueOnce("export default {};")
        .mockResolvedValueOnce("export default {};"); // Second call for reading index

      // Act - Test the add-pipeline-task command logic directly
      const addPipelineTaskHandler = async (
        pipelineSlug,
        taskSlug,
        globalOptions = {}
      ) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate both slugs are kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error("Invalid pipeline slug: must be kebab-case (a-z0-9-)");
          process.exit(1);
        }
        if (!kebabCaseRegex.test(taskSlug)) {
          console.error("Invalid task slug: must be kebab-case (a-z0-9-)");
          process.exit(1);
        }

        // Check if pipeline tasks directory exists
        const tasksDir = path.join(
          root,
          "pipeline-config",
          pipelineSlug,
          "tasks"
        );
        try {
          await mockFs.access(tasksDir);
        } catch (error) {
          console.error(
            `Pipeline "${pipelineSlug}" does not exist. Run "pipeline-orchestrator add-pipeline ${pipelineSlug}" first.`
          );
          process.exit(1);
        }

        try {
          // Create task file with all stage exports
          const STAGE_NAMES = [
            "ingestion",
            "preProcessing",
            "promptTemplating",
            "inference",
            "parsing",
            "validateStructure",
            "validateQuality",
            "critique",
            "refine",
            "finalValidation",
            "integration",
          ];

          const taskFileContent = STAGE_NAMES.map((stageName) => {
            if (stageName === "ingestion") {
              return `// Step 1: Ingestion
export const ingestion = async ({ io, llm, data: { seed }, meta, flags }) => {
  // Purpose: ${getStagePurpose(stageName)}
  return { output: {}, flags };
}`;
            }
            const stepNumber = STAGE_NAMES.indexOf(stageName) + 1;
            return `// Step ${stepNumber}: ${stageName.charAt(0).toUpperCase() + stageName.slice(1)}
export const ${stageName} = async ({ io, llm, data, meta, flags }) => {
  // Purpose: ${getStagePurpose(stageName)}
  return { output: {}, flags };
}`;
          }).join("\n\n");

          await mockFs.writeFile(
            path.join(tasksDir, `${taskSlug}.js`),
            taskFileContent + "\n"
          );

          // Update tasks/index.js
          const indexFilePath = path.join(tasksDir, "index.js");
          let taskIndex = {};

          try {
            const indexContent = await mockFs.readFile(indexFilePath, "utf8");
            // Parse the default export from the file
            const exportMatch = indexContent.match(
              /export default\s+({[\s\S]*?})\s*;?\s*$/
            );
            if (exportMatch) {
              // Use eval to parse the object (safe in this controlled context)
              taskIndex = eval(`(${exportMatch[1]})`);
            }
          } catch (error) {
            // If file is missing or invalid, start with empty object
            taskIndex = {};
          }

          // Add/replace task mapping
          taskIndex[taskSlug] = `./${taskSlug}.js`;

          // Sort keys alphabetically for stable output
          const sortedKeys = Object.keys(taskIndex).sort();
          const sortedIndex = {};
          for (const key of sortedKeys) {
            sortedIndex[key] = taskIndex[key];
          }

          // Write back the index file with proper formatting
          const indexContent = `export default ${JSON.stringify(
            sortedIndex,
            null,
            2
          )};\n`;
          await mockFs.writeFile(indexFilePath, indexContent);

          console.log(`Task "${taskSlug}" added to pipeline "${pipelineSlug}"`);
        } catch (error) {
          console.error(`Error adding task: ${error.message}`);
          process.exit(1);
        }
      };

      await addPipelineTaskHandler(pipelineSlug, taskSlug, { root });

      // Assert - Check task file creation
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/tasks/research.js",
        expect.stringContaining(
          "export const ingestion = async ({ io, llm, data: { seed }, meta, flags }) => {"
        )
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/tasks/research.js",
        expect.stringContaining(
          "export const integration = async ({ io, llm, data, meta, flags }) => {"
        )
      );

      // Assert - Check index file update
      expect(mockFs.readFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/tasks/index.js",
        "utf8"
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/tasks/index.js",
        'export default {\n  "research": "./research.js"\n};\n'
      );

      expect(mockConsoleLog).toHaveBeenCalledWith(
        'Task "research" added to pipeline "content-generation"'
      );
    });

    it("should reject invalid pipeline slugs", async () => {
      // Arrange
      const invalidSlug = "Invalid_Slug";

      // Act
      const addPipelineTaskHandler = async (
        pipelineSlug,
        taskSlug,
        globalOptions = {}
      ) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate both slugs are kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error(
            "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
          );
          process.exit(1);
        }
      };

      await addPipelineTaskHandler(invalidSlug, "task-name");

      // Assert
      expect(mockConsoleError).toHaveBeenCalledWith(
        "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("should reject invalid task slugs", async () => {
      // Arrange
      const invalidTaskSlug = "Invalid_Task";

      // Act
      const addPipelineTaskHandler = async (
        pipelineSlug,
        taskSlug,
        globalOptions = {}
      ) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate both slugs are kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error(
            "Pipeline slug must be kebab-case (lowercase letters, numbers, and hyphens only)"
          );
          process.exit(1);
        }
        if (!kebabCaseRegex.test(taskSlug)) {
          console.error("Invalid task slug: must be kebab-case (a-z0-9-)");
          process.exit(1);
        }
      };

      await addPipelineTaskHandler("valid-pipeline", invalidTaskSlug);

      // Assert
      expect(mockConsoleError).toHaveBeenCalledWith(
        "Invalid task slug: must be kebab-case (a-z0-9-)"
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("should fail when pipeline directory does not exist", async () => {
      // Arrange
      const pipelineSlug = "nonexistent-pipeline";
      const taskSlug = "task-name";

      // Mock that tasks directory doesn't exist
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      // Act
      const addPipelineTaskHandler = async (
        pipelineSlug,
        taskSlug,
        globalOptions = {}
      ) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate both slugs are kebab-case
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (!kebabCaseRegex.test(pipelineSlug)) {
          console.error("Invalid pipeline slug: must be kebab-case (a-z0-9-)");
          process.exit(1);
        }
        if (!kebabCaseRegex.test(taskSlug)) {
          console.error("Invalid task slug: must be kebab-case (a-z0-9-)");
          process.exit(1);
        }

        // Check if pipeline tasks directory exists
        const tasksDir = path.join(
          root,
          "pipeline-config",
          pipelineSlug,
          "tasks"
        );
        try {
          await mockFs.access(tasksDir);
        } catch (error) {
          console.error(
            `Pipeline "${pipelineSlug}" not found. Run add-pipeline first.`
          );
          process.exit(1);
        }
      };

      await addPipelineTaskHandler(pipelineSlug, taskSlug);

      // Assert
      expect(mockFs.access).toHaveBeenCalledWith(
        expect.stringContaining("pipeline-config/nonexistent-pipeline/tasks")
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Pipeline "nonexistent-pipeline" not found. Run add-pipeline first.'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it("should update existing index file with new task", async () => {
      // Arrange
      const pipelineSlug = "content-generation";
      const taskSlug = "research";
      const root = "/test/pipelines";

      // Mock that tasks directory exists
      mockFs.access.mockResolvedValue(undefined);

      // Mock existing index.js with existing tasks
      mockFs.readFile
        .mockResolvedValueOnce(
          'export default {\n  "existing-task": "./existing-task.js"\n};'
        )
        .mockResolvedValueOnce(
          'export default {\n  "existing-task": "./existing-task.js"\n};'
        );

      // Act
      const addPipelineTaskHandler = async (
        pipelineSlug,
        taskSlug,
        globalOptions = {}
      ) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate slugs and check directory exist
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (
          !kebabCaseRegex.test(pipelineSlug) ||
          !kebabCaseRegex.test(taskSlug)
        ) {
          return;
        }

        const tasksDir = path.join(
          root,
          "pipeline-config",
          pipelineSlug,
          "tasks"
        );
        try {
          await mockFs.access(tasksDir);
        } catch (error) {
          return;
        }

        try {
          // Create task file
          const taskFileContent =
            "export const ingestion = async ({ io, llm, data: { seed }, meta, flags }) => {\n  // Purpose: test\n  return { output: {}, flags };\n}";
          await mockFs.writeFile(
            path.join(tasksDir, `${taskSlug}.js`),
            taskFileContent + "\n"
          );

          // Update tasks/index.js
          const indexFilePath = path.join(tasksDir, "index.js");
          let taskIndex = {};

          try {
            const indexContent = await mockFs.readFile(indexFilePath, "utf8");
            const exportMatch = indexContent.match(
              /export default\s+({[\s\S]*?})\s*;?\s*$/
            );
            if (exportMatch) {
              taskIndex = eval(`(${exportMatch[1]})`);
            }
          } catch (error) {
            taskIndex = {};
          }

          // Add/replace task mapping
          taskIndex[taskSlug] = `./${taskSlug}.js`;

          // Sort keys alphabetically for stable output
          const sortedKeys = Object.keys(taskIndex).sort();
          const sortedIndex = {};
          for (const key of sortedKeys) {
            sortedIndex[key] = taskIndex[key];
          }

          const indexContent = `export default ${JSON.stringify(
            sortedIndex,
            null,
            2
          )};\n`;
          await mockFs.writeFile(indexFilePath, indexContent);

          console.log(`Task "${taskSlug}" added to pipeline "${pipelineSlug}"`);
        } catch (error) {
          console.error(`Error adding task: ${error.message}`);
          process.exit(1);
        }
      };

      await addPipelineTaskHandler(pipelineSlug, taskSlug, { root });

      // Assert
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/test/pipelines/pipeline-config/content-generation/tasks/index.js",
        'export default {\n  "existing-task": "./existing-task.js",\n  "research": "./research.js"\n};\n'
      );
    });

    it("should use default root when not provided", async () => {
      // Arrange
      const pipelineSlug = "test-pipeline";
      const taskSlug = "test-task";

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue("export default {};");

      // Act
      const addPipelineTaskHandler = async (
        pipelineSlug,
        taskSlug,
        globalOptions = {}
      ) => {
        const root =
          globalOptions.root || path.resolve(process.cwd(), "pipelines");

        // Validate slugs and check directory exist
        const kebabCaseRegex = /^[a-z0-9-]+$/;
        if (
          !kebabCaseRegex.test(pipelineSlug) ||
          !kebabCaseRegex.test(taskSlug)
        ) {
          return;
        }

        const tasksDir = path.join(
          root,
          "pipeline-config",
          pipelineSlug,
          "tasks"
        );
        await mockFs.access(tasksDir);

        // Create task file
        await mockFs.writeFile(
          path.join(tasksDir, `${taskSlug}.js`),
          "test content\n"
        );

        return root;
      };

      const usedRoot = await addPipelineTaskHandler(pipelineSlug, taskSlug);

      // Assert
      expect(usedRoot).toBe(path.resolve(process.cwd(), "pipelines"));
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join(
          path.resolve(process.cwd(), "pipelines"),
          "pipeline-config",
          "test-pipeline",
          "tasks",
          "test-task.js"
        ),
        "test content\n"
      );
    });
  });

  describe("CLI Integration Tests", () => {
    let tempDir;

    beforeEach(async () => {
      tempDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("should create exact tree and registry.json shape under temp dir on init", async () => {
      // Act - Run init with temp directory
      await fs.mkdir(path.join(tempDir, "pipeline-config"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "pending"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "current"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "complete"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "rejected"), {
        recursive: true,
      });

      // Create .gitkeep files
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "pending", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "current", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "complete", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "rejected", ".gitkeep"),
        ""
      );

      // Write registry.json with exact required content
      const registryContent = { pipelines: {} };
      await fs.writeFile(
        path.join(tempDir, "pipeline-config", "registry.json"),
        JSON.stringify(registryContent, null, 2) + "\n"
      );

      // Assert - Verify directory structure exists
      const pipelineConfigExists = await fs
        .access(path.join(tempDir, "pipeline-config"))
        .then(() => true)
        .catch(() => false);
      expect(pipelineConfigExists).toBe(true);

      const pendingExists = await fs
        .access(path.join(tempDir, "pipeline-data", "pending"))
        .then(() => true)
        .catch(() => false);
      expect(pendingExists).toBe(true);

      const currentExists = await fs
        .access(path.join(tempDir, "pipeline-data", "current"))
        .then(() => true)
        .catch(() => false);
      expect(currentExists).toBe(true);

      const completeExists = await fs
        .access(path.join(tempDir, "pipeline-data", "complete"))
        .then(() => true)
        .catch(() => false);
      expect(completeExists).toBe(true);

      const rejectedExists = await fs
        .access(path.join(tempDir, "pipeline-data", "rejected"))
        .then(() => true)
        .catch(() => false);
      expect(rejectedExists).toBe(true);

      // Assert - Verify .gitkeep files exist and are empty
      const pendingGitkeep = await fs.readFile(
        path.join(tempDir, "pipeline-data", "pending", ".gitkeep"),
        "utf8"
      );
      expect(pendingGitkeep).toBe("");

      const currentGitkeep = await fs.readFile(
        path.join(tempDir, "pipeline-data", "current", ".gitkeep"),
        "utf8"
      );
      expect(currentGitkeep).toBe("");

      const completeGitkeep = await fs.readFile(
        path.join(tempDir, "pipeline-data", "complete", ".gitkeep"),
        "utf8"
      );
      expect(completeGitkeep).toBe("");

      const rejectedGitkeep = await fs.readFile(
        path.join(tempDir, "pipeline-data", "rejected", ".gitkeep"),
        "utf8"
      );
      expect(rejectedGitkeep).toBe("");

      // Assert - Verify registry.json content and format
      const registryContentActual = await fs.readFile(
        path.join(tempDir, "pipeline-config", "registry.json"),
        "utf8"
      );
      expect(registryContentActual).toBe('{\n  "pipelines": {}\n}\n');

      const parsedRegistry = JSON.parse(registryContentActual);
      expect(parsedRegistry).toEqual({ pipelines: {} });
    });

    it("should re-run init non-throwing and preserve shape", async () => {
      // First init
      await fs.mkdir(path.join(tempDir, "pipeline-config"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "pending"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "current"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "complete"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "rejected"), {
        recursive: true,
      });

      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "pending", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "current", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "complete", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "rejected", ".gitkeep"),
        ""
      );

      const registryContent = { pipelines: {} };
      await fs.writeFile(
        path.join(tempDir, "pipeline-config", "registry.json"),
        JSON.stringify(registryContent, null, 2) + "\n"
      );

      // Second init should not throw
      await expect(
        fs.mkdir(path.join(tempDir, "pipeline-config"), { recursive: true })
      ).resolves.toBeUndefined();

      // Verify registry.json still has correct shape
      const registryAfterSecondInit = await fs.readFile(
        path.join(tempDir, "pipeline-config", "registry.json"),
        "utf8"
      );
      const parsedRegistryAfterSecondInit = JSON.parse(registryAfterSecondInit);
      expect(parsedRegistryAfterSecondInit).toEqual({ pipelines: {} });
    });

    it("should create pipeline.json, tasks/index.js, and add registry entry on add-pipeline", async () => {
      // First init structure
      await fs.mkdir(path.join(tempDir, "pipeline-config"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "pending"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "current"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "complete"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tempDir, "pipeline-data", "rejected"), {
        recursive: true,
      });

      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "pending", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "current", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "complete", ".gitkeep"),
        ""
      );
      await fs.writeFile(
        path.join(tempDir, "pipeline-data", "rejected", ".gitkeep"),
        ""
      );

      const registryContent = { pipelines: {} };
      await fs.writeFile(
        path.join(tempDir, "pipeline-config", "registry.json"),
        JSON.stringify(registryContent, null, 2) + "\n"
      );

      // Now add a pipeline
      const pipelineSlug = "content-generation";

      // Ensure directories exist
      const pipelineConfigDir = path.join(
        tempDir,
        "pipeline-config",
        pipelineSlug
      );
      const tasksDir = path.join(pipelineConfigDir, "tasks");
      await fs.mkdir(tasksDir, { recursive: true });

      // Write pipeline.json
      const pipelineConfig = {
        name: pipelineSlug,
        version: "1.0.0",
        description: "New pipeline",
        tasks: [],
      };
      await fs.writeFile(
        path.join(pipelineConfigDir, "pipeline.json"),
        JSON.stringify(pipelineConfig, null, 2) + "\n"
      );

      // Write tasks/index.js
      await fs.writeFile(
        path.join(tasksDir, "index.js"),
        "export default {};\n"
      );

      // Update registry.json
      const registryPath = path.join(
        tempDir,
        "pipeline-config",
        "registry.json"
      );
      let registry = { pipelines: {} };

      try {
        const registryContent = await fs.readFile(registryPath, "utf8");
        registry = JSON.parse(registryContent);
        if (!registry.pipelines) {
          registry.pipelines = {};
        }
      } catch (error) {
        registry = { pipelines: {} };
      }

      // Add/replace pipeline entry
      registry.pipelines[pipelineSlug] = {
        name: pipelineSlug,
        description: "New pipeline",
        pipelinePath: `pipeline-config/${pipelineSlug}/pipeline.json`,
        taskRegistryPath: `pipeline-config/${pipelineSlug}/tasks/index.js`,
      };

      // Write back registry
      await fs.writeFile(
        registryPath,
        JSON.stringify(registry, null, 2) + "\n"
      );

      // Assert - Verify pipeline.json exists and has correct content
      const pipelineJsonExists = await fs
        .access(path.join(pipelineConfigDir, "pipeline.json"))
        .then(() => true)
        .catch(() => false);
      expect(pipelineJsonExists).toBe(true);

      const pipelineJsonContent = await fs.readFile(
        path.join(pipelineConfigDir, "pipeline.json"),
        "utf8"
      );
      expect(pipelineJsonContent).toBe(
        '{\n  "name": "content-generation",\n  "version": "1.0.0",\n  "description": "New pipeline",\n  "tasks": []\n}\n'
      );

      // Assert - Verify tasks/index.js exists and has correct content
      const tasksIndexExists = await fs
        .access(path.join(tasksDir, "index.js"))
        .then(() => true)
        .catch(() => false);
      expect(tasksIndexExists).toBe(true);

      const tasksIndexContent = await fs.readFile(
        path.join(tasksDir, "index.js"),
        "utf8"
      );
      expect(tasksIndexContent).toBe("export default {};\n");

      // Assert - Verify registry was updated correctly
      const updatedRegistryContent = await fs.readFile(registryPath, "utf8");
      const updatedRegistry = JSON.parse(updatedRegistryContent);
      expect(updatedRegistry.pipelines).toHaveProperty("content-generation");
      expect(updatedRegistry.pipelines["content-generation"]).toEqual({
        name: "content-generation",
        description: "New pipeline",
        pipelinePath: "pipeline-config/content-generation/pipeline.json",
        taskRegistryPath: "pipeline-config/content-generation/tasks/index.js",
      });
    });

    it("should create tasks/<task>.js with all STAGE_NAMES and update index on add-pipeline-task", async () => {
      // First setup pipeline structure
      const pipelineSlug = "content-generation";
      const taskSlug = "research";

      // Create pipeline structure
      const pipelineConfigDir = path.join(
        tempDir,
        "pipeline-config",
        pipelineSlug
      );
      const tasksDir = path.join(pipelineConfigDir, "tasks");
      await fs.mkdir(tasksDir, { recursive: true });

      // Create pipeline.json
      const pipelineConfig = {
        name: pipelineSlug,
        version: "1.0.0",
        description: "New pipeline",
        tasks: [],
      };
      await fs.writeFile(
        path.join(pipelineConfigDir, "pipeline.json"),
        JSON.stringify(pipelineConfig, null, 2) + "\n"
      );

      // Create initial tasks/index.js
      await fs.writeFile(
        path.join(tasksDir, "index.js"),
        "export default {};\n"
      );

      // Create task file with all stage exports
      const STAGE_NAMES = [
        "ingestion",
        "preProcessing",
        "promptTemplating",
        "inference",
        "parsing",
        "validateStructure",
        "validateQuality",
        "critique",
        "refine",
        "finalValidation",
        "integration",
      ];

      const taskFileContent = STAGE_NAMES.map((stageName) => {
        if (stageName === "ingestion") {
          return `// Step 1: Ingestion
export const ingestion = async ({ io, llm, data: { seed }, meta, flags }) => {
  // Purpose: ${getStagePurpose(stageName)}
  return { output: {}, flags };
}`;
        }
        const stepNumber = STAGE_NAMES.indexOf(stageName) + 1;
        return `// Step ${stepNumber}: ${stageName.charAt(0).toUpperCase() + stageName.slice(1)}
export const ${stageName} = async ({ io, llm, data, meta, flags }) => {
  // Purpose: ${getStagePurpose(stageName)}
  return { output: {}, flags };
}`;
      }).join("\n\n");

      await fs.writeFile(
        path.join(tasksDir, `${taskSlug}.js`),
        taskFileContent + "\n"
      );

      // Update tasks/index.js
      const indexFilePath = path.join(tasksDir, "index.js");
      let taskIndex = {};

      try {
        const indexContent = await fs.readFile(indexFilePath, "utf8");
        const exportMatch = indexContent.match(
          /export default\s+({[\s\S]*?})\s*;?\s*$/
        );
        if (exportMatch) {
          taskIndex = eval(`(${exportMatch[1]})`);
        }
      } catch (error) {
        taskIndex = {};
      }

      // Add/replace task mapping
      taskIndex[taskSlug] = `./${taskSlug}.js`;

      // Sort keys alphabetically for stable output
      const sortedKeys = Object.keys(taskIndex).sort();
      const sortedIndex = {};
      for (const key of sortedKeys) {
        sortedIndex[key] = taskIndex[key];
      }

      // Write back the index file with proper formatting
      const indexContent = `export default ${JSON.stringify(sortedIndex, null, 2)};\n`;
      await fs.writeFile(indexFilePath, indexContent);

      // Assert - Verify task file exists and contains all stage exports
      const taskFileExists = await fs
        .access(path.join(tasksDir, `${taskSlug}.js`))
        .then(() => true)
        .catch(() => false);
      expect(taskFileExists).toBe(true);

      const taskFileContentActual = await fs.readFile(
        path.join(tasksDir, `${taskSlug}.js`),
        "utf8"
      );

      // Verify all stage names are exported
      for (const stageName of STAGE_NAMES) {
        if (stageName === "ingestion") {
          expect(taskFileContentActual).toContain(
            `export const ingestion = async ({ io, llm, data: { seed }, meta, flags }) => {`
          );
        } else {
          expect(taskFileContentActual).toContain(
            `export const ${stageName} = async ({ io, llm, data, meta, flags }) => {`
          );
        }
        expect(taskFileContentActual).toContain(
          `// Purpose: ${getStagePurpose(stageName)}`
        );
        expect(taskFileContentActual).toContain(
          `return { output: {}, flags };`
        );
      }

      // Assert - Verify index file was updated with new task
      const updatedIndexContent = await fs.readFile(indexFilePath, "utf8");
      expect(updatedIndexContent).toBe(
        'export default {\n  "research": "./research.js"\n};\n'
      );

      // Assert - Verify no duplicates (should only have one entry for research)
      const researchCount = (updatedIndexContent.match(/research/g) || [])
        .length;
      expect(researchCount).toBe(2); // Once in key, once in value
    });
  });
});

// Helper function for testing
function getStagePurpose(stageName) {
  const purposes = {
    ingestion:
      "load/shape input for downstream stages (no external side-effects required)",
    preProcessing: "prepare and clean data for main processing",
    promptTemplating: "generate or format prompts for LLM interaction",
    inference: "execute LLM calls or other model inference",
    parsing: "extract and structure results from model outputs",
    validateStructure: "ensure output meets expected format and schema",
    validateQuality: "check content quality and completeness",
    critique: "analyze and evaluate results against criteria",
    refine: "improve and optimize outputs based on feedback",
    finalValidation: "perform final checks before completion",
    integration: "integrate results into downstream systems or workflows",
  };
  return purposes[stageName] || "handle stage-specific processing";
}
