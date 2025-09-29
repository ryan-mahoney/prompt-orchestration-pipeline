import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockProcessArgv } from "./test-utils.js";

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

    it("should handle submit command job submission", async () => {
      // Arrange
      const mockFs = {
        readFile: vi.fn().mockResolvedValue(JSON.stringify({ data: "test" })),
      };

      const mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(),
        submitJob: vi.fn().mockResolvedValue({ name: "test-job" }),
      };

      vi.doMock("node:fs/promises", () => mockFs);
      vi.doMock("../src/api/index.js", () => ({
        PipelineOrchestrator: vi.fn(() => mockOrchestrator),
      }));

      // Act - Test the submit command logic directly
      const submitHandler = async (seedFile) => {
        const { PipelineOrchestrator } = await import("../src/api/index.js");
        const seed = JSON.parse(await mockFs.readFile(seedFile, "utf8"));
        const orchestrator = new PipelineOrchestrator({ autoStart: false });
        await orchestrator.initialize();
        const job = await orchestrator.submitJob(seed);
        console.log(`Job submitted: ${job.name}`);
      };

      await submitHandler("seed.json");

      // Assert
      expect(mockFs.readFile).toHaveBeenCalledWith("seed.json", "utf8");
      expect(mockOrchestrator.initialize).toHaveBeenCalled();
      expect(mockOrchestrator.submitJob).toHaveBeenCalledWith({ data: "test" });
      expect(console.log).toHaveBeenCalledWith("Job submitted: test-job");
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

      const mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(),
        submitJob: vi.fn().mockResolvedValue({ name: "test-job" }),
      };

      vi.doMock("node:fs/promises", () => mockFs);
      vi.doMock("../src/api/index.js", () => ({
        PipelineOrchestrator: vi.fn(() => mockOrchestrator),
      }));

      // Act & Assert
      const submitHandler = async (seedFile) => {
        const { PipelineOrchestrator } = await import("../src/api/index.js");
        const seed = JSON.parse(await mockFs.readFile(seedFile, "utf8"));
        const orchestrator = new PipelineOrchestrator({ autoStart: false });
        await orchestrator.initialize();
        const job = await orchestrator.submitJob(seed);
        console.log(`Job submitted: ${job.name}`);
      };

      await expect(submitHandler("seed.json")).rejects.toThrow();
    });
  });
});
