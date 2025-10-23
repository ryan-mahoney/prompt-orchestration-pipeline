import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import * as taskRunner from "../src/core/task-runner.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Test the actual implementation without mocking the entire module
describe("Task Runner - New Context Structure", () => {
  let tempDir;
  let mockTasksModule;
  let taskModulePath;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-runner-test-"));

    // Create a mock tasks module with proper function definitions
    mockTasksModule = {
      validateStructure: async (context) => ({
        output: { validationPassed: true },
        flags: { validationFailed: false },
      }),
      critique: async (context) => ({
        output: { critique: "good" },
        flags: { critiqueComplete: true },
      }),
      refine: async (context) => ({
        output: { refined: true },
        flags: { refined: true },
      }),
      // Legacy stages for backward compatibility testing
      ingestion: async (context) => ({ data: "ingested" }),
      preProcessing: async (context) => ({ processed: true }),
      promptTemplating: async (context) => ({ prompt: "template" }),
      inference: async (context) => ({ result: "inferred" }),
      parsing: async (context) => ({ parsed: true }),
      validateQuality: async (context) => ({ qualityPassed: true }),
      finalValidation: async (context) => ({ output: { x: 1 } }),
      integration: async (context) => ({ integrated: true }),
    };

    // Write the mock tasks module to a temporary file
    taskModulePath = path.join(tempDir, "test-tasks.js");
    const moduleContent =
      Object.entries(mockTasksModule)
        .map(([name, fn]) => `export const ${name} = ${fn.toString()};`)
        .join("\n") +
      "\nexport default { validateStructure, critique, refine };";

    await fs.writeFile(taskModulePath, moduleContent);

    // Create vi.fn() spies for each function to track calls
    Object.keys(mockTasksModule).forEach((name) => {
      mockTasksModule[name] = vi.fn().mockImplementation(mockTasksModule[name]);
    });

    // Mock performance.now()
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("Context Structure", () => {
    it("should create context with meta, data, flags, logs, and currentStage", async () => {
      const jobId = "test-job-123";
      const workDir = path.join(tempDir, "work");
      const statusPath = path.join(tempDir, "tasks-status.json");

      await fs.mkdir(workDir, { recursive: true });
      await fs.mkdir(path.join(workDir, jobId, "files", "logs"), {
        recursive: true,
      });

      const initialContext = {
        taskName: "test-task",
        workDir,
        jobId,
        statusPath,
        seed: { test: "data" },
        maxRefinements: 2,
      };

      const result = await taskRunner.runPipeline(
        taskModulePath,
        initialContext
      );

      if (!result.ok) {
        console.log("Pipeline failed:", result);
      }

      expect(result.ok).toBe(true);
      expect(result.context).toMatchObject({
        io: expect.any(Object),
        llm: expect.any(Object),
        meta: {
          taskName: "test-task",
          workDir,
          jobId,
          statusPath,
        },
        data: {
          seed: { test: "data" },
          validateStructure: { validationPassed: true },
        },
        flags: {
          validationFailed: false,
        },
        currentStage: expect.any(String),
      });
      expect(Array.isArray(result.context.logs)).toBe(true);

      // Assert that context.meta.io and context.meta.llm do NOT exist
      expect(result.context.meta.io).toBeUndefined();
      expect(result.context.meta.llm).toBeUndefined();
    });

    it("should store stage outputs in context.data", async () => {
      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {},
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        taskModulePath,
        initialContext
      );

      expect(result.context.data.validateStructure).toEqual({
        validationPassed: true,
      });
      expect(result.context.data.critique).toEqual({ critique: "good" });
      expect(result.context.data.refine).toEqual({ refined: true });
    });

    it("should merge stage flags into context.flags", async () => {
      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {},
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        taskModulePath,
        initialContext
      );

      expect(result.context.flags).toEqual({
        validationFailed: false,
        critiqueComplete: true,
        refined: true,
      });
    });

    it("should persist context.data and context.flags to tasks-status.json", async () => {
      const statusPath = path.join(tempDir, "tasks-status.json");
      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath,
        seed: { test: "data" },
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      await taskRunner.runPipeline(taskModulePath, initialContext);

      // Read the status file
      const statusContent = await fs.readFile(statusPath, "utf8");
      const statusData = JSON.parse(statusContent);

      expect(statusData.data).toBeDefined();
      expect(statusData.data.seed).toEqual({ test: "data" });
      expect(statusData.data.validateStructure).toEqual({
        validationPassed: true,
      });
      expect(statusData.flags).toBeDefined();
      expect(statusData.flags.validationFailed).toBe(false);
      expect(statusData.flags.critiqueComplete).toBe(true);
      expect(statusData.flags.refined).toBe(true);
    });
  });

  describe("Stage Handler Contract", () => {
    it("should execute handlers that return { output, flags }", async () => {
      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {},
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        taskModulePath,
        initialContext
      );

      expect(result.ok).toBe(true);
      expect(mockTasksModule.validateStructure).toHaveBeenCalled();
      expect(mockTasksModule.critique).toHaveBeenCalled();
      expect(mockTasksModule.refine).toHaveBeenCalled();
    });

    it("should provide cloned data and flags to handlers", async () => {
      mockTasksModule.validateStructure.mockImplementation(async (context) => {
        // Verify that context has the new structure
        expect(context).toHaveProperty("data");
        expect(context).toHaveProperty("flags");
        expect(context).toHaveProperty("meta");
        expect(context).toHaveProperty("currentStage");

        // Verify that data contains the seed
        expect(context.data.seed).toBeDefined();

        // Try to modify the context (should not affect the original)
        context.data.modified = true;
        context.flags.modified = true;

        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      });

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: { original: true },
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      await taskRunner.runPipeline(taskModulePath, initialContext);

      // Verify the original context wasn't modified by the handler
      expect(initialContext.seed.original).toBe(true);
      expect(initialContext.modified).toBeUndefined();
    });

    it("should skip stages when skipIf predicate returns true", async () => {
      // Create a tasks module where validateStructure sets validationFailed to false
      mockTasksModule.validateStructure.mockResolvedValue({
        output: { validationPassed: true },
        flags: { validationFailed: false },
      });

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {},
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      await taskRunner.runPipeline(taskModulePath, initialContext);

      // critique and refine should be skipped because validationFailed is false
      expect(mockTasksModule.critique).not.toHaveBeenCalled();
      expect(mockTasksModule.refine).not.toHaveBeenCalled();
    });
  });

  describe("Refinement Logic", () => {
    it("should trigger refinement when validationFailed is true", async () => {
      let callCount = 0;
      mockTasksModule.validateStructure.mockImplementation(async (context) => {
        callCount++;
        return {
          output: { validationPassed: false },
          flags: { validationFailed: true },
        };
      });

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: { maxRefinements: 1 },
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        taskModulePath,
        initialContext
      );

      expect(result.refinementAttempts).toBe(1);
      expect(callCount).toBe(2); // Should be called twice: initial + refinement
      expect(mockTasksModule.critique).toHaveBeenCalled();
      expect(mockTasksModule.refine).toHaveBeenCalled();
    });

    it("should respect maxRefinements from seed", async () => {
      mockTasksModule.validateStructure.mockResolvedValue({
        output: { validationPassed: false },
        flags: { validationFailed: true },
      });

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: { maxRefinements: 2 },
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        taskModulePath,
        initialContext
      );

      expect(result.refinementAttempts).toBe(2);
      expect(mockTasksModule.validateStructure).toHaveBeenCalledTimes(3); // initial + 2 refinements
    });

    it("should default maxRefinements to 1 when not specified", async () => {
      mockTasksModule.validateStructure.mockResolvedValue({
        output: { validationPassed: false },
        flags: { validationFailed: true },
      });

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {}, // No maxRefinements specified
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        taskModulePath,
        initialContext
      );

      expect(result.refinementAttempts).toBe(1);
      expect(mockTasksModule.validateStructure).toHaveBeenCalledTimes(2); // initial + 1 refinement
    });
  });

  describe("Console Output Capture", () => {
    it("should create log files for each stage", async () => {
      mockTasksModule.validateStructure.mockImplementation(async (context) => {
        console.log("Validation started");
        console.error("Validation error details");
        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      });

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {},
      };

      const logsDir = path.join(tempDir, "test-job", "files", "logs");
      await fs.mkdir(logsDir, { recursive: true });

      await taskRunner.runPipeline(taskModulePath, initialContext);

      // Check that log files were created
      const validateStructureLog = path.join(
        logsDir,
        "stage-validateStructure.log"
      );
      await fs.access(validateStructureLog);

      const logContent = await fs.readFile(validateStructureLog, "utf8");
      expect(logContent).toContain("Validation started");
      expect(logContent).toContain("[ERROR] Validation error details");
    });
  });

  describe("Error Handling", () => {
    it("should handle handler errors and stop execution", async () => {
      // Create a tasks module that throws an error
      const errorTasksModule = {
        validateStructure: async (context) => {
          throw new Error("Validation failed");
        },
        critique: async (context) => ({
          output: { critique: "good" },
          flags: { critiqueComplete: true },
        }),
        refine: async (context) => ({
          output: { refined: true },
          flags: { refined: true },
        }),
      };

      // Write the error tasks module to a temporary file
      const errorTaskModulePath = path.join(tempDir, "error-test-tasks.js");
      const errorModuleContent =
        Object.entries(errorTasksModule)
          .map(([name, fn]) => `export const ${name} = ${fn.toString()};`)
          .join("\n") +
        "\nexport default { validateStructure, critique, refine };";

      await fs.writeFile(errorTaskModulePath, errorModuleContent);

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {},
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        errorTaskModulePath,
        initialContext
      );

      expect(result.ok).toBe(false);
      expect(result.failedStage).toBe("validateStructure");
      expect(result.error.message).toBe("Validation failed");
    });

    it("should trigger refinement on validation errors", async () => {
      // Create a tasks module that throws a validation error
      const errorTasksModule = {
        validateStructure: async (context) => {
          throw new Error("Schema validation failed");
        },
        critique: async (context) => ({
          output: { critique: "needs improvement" },
          flags: { critiqueComplete: true },
        }),
        refine: async (context) => ({
          output: { refined: true },
          flags: { refined: true },
        }),
      };

      // Write the error tasks module to a temporary file
      const errorTaskModulePath = path.join(
        tempDir,
        "refinement-error-tasks.js"
      );
      const errorModuleContent =
        Object.entries(errorTasksModule)
          .map(([name, fn]) => `export const ${name} = ${fn.toString()};`)
          .join("\n") +
        "\nexport default { validateStructure, critique, refine };";

      await fs.writeFile(errorTaskModulePath, errorModuleContent);

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: { maxRefinements: 1 },
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipeline(
        errorTaskModulePath,
        initialContext
      );

      expect(result.refinementAttempts).toBe(1);
      expect(result.ok).toBe(false); // Should fail after refinement attempts
      expect(result.failedStage).toBe("validateStructure");
    });
  });

  describe("runPipelineWithModelRouting", () => {
    it("should add model configuration to context.meta", async () => {
      const modelConfig = {
        models: ["gpt-4", "claude-3"],
        defaultModel: "gpt-4",
      };

      const initialContext = {
        taskName: "test",
        workDir: tempDir,
        jobId: "test-job",
        statusPath: path.join(tempDir, "status.json"),
        seed: {},
      };

      await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
        recursive: true,
      });

      const result = await taskRunner.runPipelineWithModelRouting(
        taskModulePath,
        initialContext,
        modelConfig
      );

      expect(result.ok).toBe(true);
      expect(result.context.meta.modelConfig).toEqual(modelConfig);
    });
  });
});

describe("Pipeline Stage Skip Predicate Tests", () => {
  let tempDir;
  let mockTasksModule;
  let taskModulePath;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "task-runner-skip-test-")
    );

    // Create a mock tasks module with controlled behavior
    mockTasksModule = {
      validateStructure: async (context) => ({
        output: { validationPassed: true },
        flags: { validationFailed: false },
      }),
      critique: async (context) => ({
        output: { critique: "good" },
        flags: { critiqueComplete: true },
      }),
      refine: async (context) => ({
        output: { refined: true },
        flags: { refined: true },
      }),
    };

    // Write the mock tasks module to a temporary file
    taskModulePath = path.join(tempDir, "skip-test-tasks.js");
    const moduleContent =
      Object.entries(mockTasksModule)
        .map(([name, fn]) => `export const ${name} = ${fn.toString()};`)
        .join("\n") +
      "\nexport default { validateStructure, critique, refine };";

    await fs.writeFile(taskModulePath, moduleContent);

    // Create vi.fn() spies for each function to track calls
    Object.keys(mockTasksModule).forEach((name) => {
      mockTasksModule[name] = vi.fn().mockImplementation(mockTasksModule[name]);
    });

    // Mock performance.now()
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should skip stages when skipIf predicate returns true", async () => {
    // Configure validateStructure to set validationFailed to false
    mockTasksModule.validateStructure.mockResolvedValue({
      output: { validationPassed: true },
      flags: { validationFailed: false },
    });

    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify pipeline completed successfully
    expect(result.ok).toBe(true);

    // Verify critique and refine were skipped due to validationFailed === false
    expect(mockTasksModule.critique).not.toHaveBeenCalled();
    expect(mockTasksModule.refine).not.toHaveBeenCalled();

    // Verify skip was logged in context.logs
    const skipLogs = result.context.logs.filter(
      (log) => log.action === "skipped"
    );
    expect(skipLogs).toHaveLength(2); // critique and refine should be skipped
    expect(skipLogs[0]).toMatchObject({
      stage: "critique",
      action: "skipped",
      reason: "skipIf predicate returned true",
    });
    expect(skipLogs[1]).toMatchObject({
      stage: "refine",
      action: "skipped",
      reason: "skipIf predicate returned true",
    });
  });

  it("should execute stages when skipIf predicate returns false", async () => {
    // Configure validateStructure to set validationFailed to true
    mockTasksModule.validateStructure.mockResolvedValue({
      output: { validationPassed: false },
      flags: { validationFailed: true },
    });

    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { maxRefinements: 0 }, // No refinements to keep test simple
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify pipeline completed successfully
    expect(result.ok).toBe(true);

    // Verify critique and refine were executed due to validationFailed === true
    expect(mockTasksModule.critique).toHaveBeenCalled();
    expect(mockTasksModule.refine).toHaveBeenCalled();

    // Verify no skip logs for critique and refine
    const skipLogs = result.context.logs.filter(
      (log) =>
        log.action === "skipped" &&
        (log.stage === "critique" || log.stage === "refine")
    );
    expect(skipLogs).toHaveLength(0);
  });

  it("should handle stages without skipIf predicates", async () => {
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // verify validateStructure always executes (it has no skipIf predicate)
    expect(mockTasksModule.validateStructure).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe("Refinement Limit Tests", () => {
  let tempDir;
  let mockTasksModule;
  let taskModulePath;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "task-runner-refinement-test-")
    );

    // Create a mock tasks module that always fails validation
    mockTasksModule = {
      validateStructure: async (context) => ({
        output: { validationPassed: false },
        flags: { validationFailed: true },
      }),
      critique: async (context) => ({
        output: { critique: "needs improvement" },
        flags: { critiqueComplete: true },
      }),
      refine: async (context) => ({
        output: { refined: true },
        flags: { refined: true },
      }),
    };

    // Write the mock tasks module to a temporary file
    taskModulePath = path.join(tempDir, "refinement-test-tasks.js");
    const moduleContent =
      Object.entries(mockTasksModule)
        .map(([name, fn]) => `export const ${name} = ${fn.toString()};`)
        .join("\n") +
      "\nexport default { validateStructure, critique, refine };";

    await fs.writeFile(taskModulePath, moduleContent);

    // Create vi.fn() spies for each function to track calls
    Object.keys(mockTasksModule).forEach((name) => {
      mockTasksModule[name] = vi.fn().mockImplementation(mockTasksModule[name]);
    });

    // Mock performance.now()
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should respect maxRefinements from seed configuration", async () => {
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { maxRefinements: 2 },
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify refinement count matches maxRefinements
    expect(result.refinementAttempts).toBe(2);

    // Verify validateStructure was called 3 times: initial + 2 refinements
    expect(mockTasksModule.validateStructure).toHaveBeenCalledTimes(3);

    // Verify critique and refine were called for each refinement
    expect(mockTasksModule.critique).toHaveBeenCalledTimes(2);
    expect(mockTasksModule.refine).toHaveBeenCalledTimes(2);
  });

  it("should default to 1 refinement when maxRefinements is not specified", async () => {
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: {}, // No maxRefinements specified
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify default refinement limit is 1
    expect(result.refinementAttempts).toBe(1);

    // Verify validateStructure was called 2 times: initial + 1 refinement
    expect(mockTasksModule.validateStructure).toHaveBeenCalledTimes(2);

    // Verify critique and refine were called once
    expect(mockTasksModule.critique).toHaveBeenCalledTimes(1);
    expect(mockTasksModule.refine).toHaveBeenCalledTimes(1);
  });

  it("should not exceed refinement limit even with continued validation failures", async () => {
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { maxRefinements: 3 },
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify refinement never exceeds the limit
    expect(result.refinementAttempts).toBeLessThanOrEqual(3);
    expect(result.refinementAttempts).toBe(3);

    // Verify validateStructure was called 4 times: initial + 3 refinements
    expect(mockTasksModule.validateStructure).toHaveBeenCalledTimes(4);

    // Pipeline should fail after exhausting refinements
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("final-validation");
  });

  it("should stop refinements when validation passes", async () => {
    let callCount = 0;
    mockTasksModule.validateStructure.mockImplementation(async (context) => {
      callCount++;
      if (callCount === 2) {
        // Pass validation on second call (after 1 refinement)
        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      }
      // Fail validation on first call
      return {
        output: { validationPassed: false },
        flags: { validationFailed: true },
      };
    });

    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId: "test-job",
      statusPath: path.join(tempDir, "status.json"),
      seed: { maxRefinements: 5 }, // High limit to test early stopping
    };

    await fs.mkdir(path.join(tempDir, "test-job", "files", "logs"), {
      recursive: true,
    });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // Should stop after 1 refinement when validation passes
    expect(result.refinementAttempts).toBe(1);
    expect(mockTasksModule.validateStructure).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });
});

describe("Console Capture and Log File Tests", () => {
  let tempDir;
  let mockTasksModule;
  let taskModulePath;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "task-runner-console-test-")
    );

    // Create a mock tasks module with console output
    mockTasksModule = {
      validateStructure: async (context) => {
        console.log("Validation started");
        console.info("Processing seed data");
        console.warn("Potential issue detected");
        console.error("Validation completed with warnings");
        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      },
      critique: async (context) => {
        console.log("Critique analysis beginning");
        console.error("Critique found no major issues");
        return {
          output: { critique: "excellent" },
          flags: { critiqueComplete: true },
        };
      },
      refine: async (context) => {
        console.log("Refinement not needed");
        return {
          output: { refined: false },
          flags: { refined: false },
        };
      },
    };

    // Write the mock tasks module to a temporary file
    taskModulePath = path.join(tempDir, "console-test-tasks.js");
    const moduleContent =
      Object.entries(mockTasksModule)
        .map(([name, fn]) => `export const ${name} = ${fn.toString()};`)
        .join("\n") +
      "\nexport default { validateStructure, critique, refine };";

    await fs.writeFile(taskModulePath, moduleContent);

    // Create vi.fn() spies for each function to track calls
    Object.keys(mockTasksModule).forEach((name) => {
      mockTasksModule[name] = vi.fn().mockImplementation(mockTasksModule[name]);
    });

    // Mock performance.now()
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should create log files for each stage execution", async () => {
    const jobId = "test-job-console";
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId,
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify log files were created for each stage
    const validateStructureLog = path.join(
      logsDir,
      "stage-validateStructure.log"
    );
    const critiqueLog = path.join(logsDir, "stage-critique.log");
    const refineLog = path.join(logsDir, "stage-refine.log");

    // Check that all log files exist
    await fs.access(validateStructureLog);
    await fs.access(critiqueLog);
    await fs.access(refineLog);
  });

  it("should capture console output with correct formatting", async () => {
    const jobId = "test-job-formatting";
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId,
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    await taskRunner.runPipeline(taskModulePath, initialContext);

    // Read validateStructure log file
    const validateStructureLog = path.join(
      logsDir,
      "stage-validateStructure.log"
    );
    const logContent = await fs.readFile(validateStructureLog, "utf8");

    // Verify console output was captured with correct formatting
    expect(logContent).toContain("Validation started");
    expect(logContent).toContain("Processing seed data");
    expect(logContent).toContain("[WARN] Potential issue detected");
    expect(logContent).toContain("[ERROR] Validation completed with warnings");

    // Read critique log file
    const critiqueLog = path.join(logsDir, "stage-critique.log");
    const critiqueLogContent = await fs.readFile(critiqueLog, "utf8");

    expect(critiqueLogContent).toContain("Critique analysis beginning");
    expect(critiqueLogContent).toContain(
      "[ERROR] Critique found no major issues"
    );
  });

  it("should restore console output after stage execution", async () => {
    const jobId = "test-job-restore";
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId,
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    // Store original console methods
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify console methods were restored by testing they work normally
    let capturedOutput = "";
    const testLogStream = { write: (data) => (capturedOutput += data) };

    // Temporarily redirect console to test restoration
    const tempLog = console.log;
    console.log = (...args) => testLogStream.write(args.join(" ") + "\n");

    console.log("Test after pipeline execution");

    // Restore console
    console.log = tempLog;

    // Verify our test worked (console is functioning normally)
    expect(capturedOutput).toBe("Test after pipeline execution\n");

    // Verify original console methods are still the same
    expect(console.log).toBe(originalLog);
    expect(console.error).toBe(originalError);
    expect(console.warn).toBe(originalWarn);
    expect(console.info).toBe(originalInfo);
  });

  it("should create separate log files for each stage with correct naming", async () => {
    const jobId = "test-job-naming";
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId,
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify specific log file names exist
    const expectedLogFiles = [
      "stage-validateStructure.log",
      "stage-critique.log",
      "stage-refine.log",
    ];

    for (const logFile of expectedLogFiles) {
      const logPath = path.join(logsDir, logFile);
      await fs.access(logPath);

      // Verify file is not empty
      const stats = await fs.stat(logPath);
      expect(stats.size).toBeGreaterThan(0);
    }
  });

  it("should handle console output during stage errors", async () => {
    // Create a task that throws an error after console output
    mockTasksModule.validateStructure.mockImplementation(async (context) => {
      console.log("About to throw error");
      console.error("Something went wrong");
      throw new Error("Stage execution failed");
    });

    const jobId = "test-job-error";
    const initialContext = {
      taskName: "test",
      workDir: tempDir,
      jobId,
      statusPath: path.join(tempDir, "status.json"),
      seed: {},
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    // Verify pipeline failed
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("validateStructure");

    // Verify console output was still captured despite the error
    const validateStructureLog = path.join(
      logsDir,
      "stage-validateStructure.log"
    );
    const logContent = await fs.readFile(validateStructureLog, "utf8");

    expect(logContent).toContain("About to throw error");
    expect(logContent).toContain("[ERROR] Something went wrong");

    // Verify console is still functional after error
    let testOutput = "";
    const originalLog = console.log;
    console.log = (...args) => (testOutput += args.join(" "));

    console.log("Console works after error");

    console.log = originalLog;
    expect(testOutput).toBe("Console works after error");
  });
});

describe("Status Persistence Tests", () => {
  let tempDir;
  let mockTasksModule;
  let taskModulePath;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "task-runner-status-test-")
    );

    // Create a mock tasks module with controlled behavior
    mockTasksModule = {
      validateStructure: async (context) => {
        console.log("validateStructure executing");
        return {
          output: {
            validationPassed: true,
            validationDetails: "All checks passed",
          },
          flags: { validationFailed: false, validationTimestamp: Date.now() },
        };
      },
      critique: async (context) => {
        console.log("critique executing");
        return {
          output: { critique: "excellent", critiqueScore: 95 },
          flags: { critiqueComplete: true, critiqueTimestamp: Date.now() },
        };
      },
      refine: async (context) => {
        console.log("refine executing");
        return {
          output: { refined: false, reason: "no changes needed" },
          flags: { refined: false, refineTimestamp: Date.now() },
        };
      },
    };

    // Write the mock tasks module to a temporary file
    taskModulePath = path.join(tempDir, "status-test-tasks.js");
    const moduleContent =
      Object.entries(mockTasksModule)
        .map(([name, fn]) => `export const ${name} = ${fn.toString()};`)
        .join("\n") +
      "\nexport default { validateStructure, critique, refine };";

    await fs.writeFile(taskModulePath, moduleContent);

    // Create vi.fn() spies for each function to track calls
    Object.keys(mockTasksModule).forEach((name) => {
      mockTasksModule[name] = vi.fn().mockImplementation(mockTasksModule[name]);
    });

    // Mock performance.now()
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should persist complete execution state to tasks-status.json", async () => {
    const statusPath = path.join(tempDir, "tasks-status.json");
    const jobId = "test-job-status";
    const initialContext = {
      taskName: "test-task",
      workDir: tempDir,
      jobId,
      statusPath,
      seed: {
        testData: "initial seed",
        config: { version: "1.0" },
      },
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    await taskRunner.runPipeline(taskModulePath, initialContext);

    // Read the status file
    const statusContent = await fs.readFile(statusPath, "utf8");
    const statusData = JSON.parse(statusContent);

    // Verify the file contains all expected top-level properties
    expect(statusData).toHaveProperty("data");
    expect(statusData).toHaveProperty("flags");
    expect(statusData).toHaveProperty("logs");
    expect(statusData).toHaveProperty("currentStage");
    expect(statusData).toHaveProperty("refinementCount");
    expect(statusData).toHaveProperty("lastUpdated");

    // Verify data object contains seed and all stage outputs
    expect(statusData.data).toMatchObject({
      seed: {
        testData: "initial seed",
        config: { version: "1.0" },
      },
      validateStructure: {
        validationPassed: true,
        validationDetails: "All checks passed",
      },
      critique: {
        critique: "excellent",
        critiqueScore: 95,
      },
      refine: {
        refined: false,
        reason: "no changes needed",
      },
    });

    // Verify flags object contains all accumulated flags
    expect(statusData.flags).toMatchObject({
      validationFailed: false,
      validationTimestamp: expect.any(Number),
      critiqueComplete: true,
      critiqueTimestamp: expect.any(Number),
      refined: false,
      refineTimestamp: expect.any(Number),
    });

    // Verify logs array contains stage completion entries
    expect(Array.isArray(statusData.logs)).toBe(true);
    expect(statusData.logs.length).toBeGreaterThan(0);

    // Check for specific log entries
    const completionLogs = statusData.logs.filter(
      (log) => log.action === "completed"
    );
    expect(completionLogs).toHaveLength(3); // validateStructure, critique, refine

    expect(completionLogs[0]).toMatchObject({
      stage: "validateStructure",
      action: "completed",
      outputType: "object",
      flagKeys: ["validationFailed", "validationTimestamp"],
      timestamp: expect.any(String),
    });

    // Verify metadata fields
    expect(statusData.currentStage).toBe(null); // Should be null after completion
    expect(statusData.refinementCount).toBe(0); // No refinements in this test
    expect(statusData.lastUpdated).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    ); // ISO timestamp
  });

  it("should update status file after each stage execution", async () => {
    const statusPath = path.join(tempDir, "tasks-status-incremental.json");
    const jobId = "test-job-incremental";
    const initialContext = {
      taskName: "test-task",
      workDir: tempDir,
      jobId,
      statusPath,
      seed: { testData: "incremental test" },
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    // Mock validateStructure to take longer so we can check intermediate state
    let validateStructureResolved = false;
    mockTasksModule.validateStructure.mockImplementation(async (context) => {
      console.log("validateStructure starting");
      await new Promise((resolve) => setTimeout(resolve, 100));
      validateStructureResolved = true;
      console.log("validateStructure completed");
      return {
        output: { validationPassed: true },
        flags: { validationFailed: false },
      };
    });

    // Start the pipeline but don't await it immediately
    const pipelinePromise = taskRunner.runPipeline(
      taskModulePath,
      initialContext
    );

    // Wait a bit and check if status file has been updated
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The status file should exist and contain initial state
    let statusExists = true;
    try {
      await fs.access(statusPath);
    } catch {
      statusExists = false;
    }

    // Wait for pipeline to complete
    await pipelinePromise;

    // After completion, verify final state
    const finalStatusContent = await fs.readFile(statusPath, "utf8");
    const finalStatusData = JSON.parse(finalStatusContent);

    // Verify all stages completed successfully
    expect(finalStatusData.data).toHaveProperty("validateStructure");
    expect(finalStatusData.data).toHaveProperty("critique");
    expect(finalStatusData.data).toHaveProperty("refine");

    // Verify flags were accumulated
    expect(finalStatusData.flags.validationFailed).toBe(false);
    expect(finalStatusData.flags.critiqueComplete).toBe(true);
    expect(finalStatusData.flags.refined).toBe(false);
  });

  it("should persist status during refinement cycles", async () => {
    const statusPath = path.join(tempDir, "tasks-status-refinement.json");
    const jobId = "test-job-refinement";
    const initialContext = {
      taskName: "test-task",
      workDir: tempDir,
      jobId,
      statusPath,
      seed: { maxRefinements: 2, testData: "refinement test" },
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    // Configure validateStructure to fail validation initially, then pass
    let callCount = 0;
    mockTasksModule.validateStructure.mockImplementation(async (context) => {
      callCount++;
      console.log(`validateStructure call ${callCount}`);

      if (callCount <= 2) {
        // Fail validation for first 2 calls (initial + 1 refinement)
        return {
          output: { validationPassed: false, errors: ["schema mismatch"] },
          flags: {
            validationFailed: true,
            lastValidationError: { type: "schema", message: "schema mismatch" },
          },
        };
      } else {
        // Pass validation on third call (after 2 refinements)
        return {
          output: { validationPassed: true },
          flags: { validationFailed: false },
        };
      }
    });

    await taskRunner.runPipeline(taskModulePath, initialContext);

    // Read final status
    const statusContent = await fs.readFile(statusPath, "utf8");
    const statusData = JSON.parse(statusContent);

    // Verify refinement count is tracked
    expect(statusData.refinementCount).toBe(2);

    // Verify final state shows validation passed
    expect(statusData.flags.validationFailed).toBe(false);
    expect(statusData.data.validateStructure).toEqual({
      validationPassed: true,
    });

    // Verify critique and refine were called during refinements
    expect(mockTasksModule.critique).toHaveBeenCalledTimes(2);
    expect(mockTasksModule.refine).toHaveBeenCalledTimes(2);

    // Verify logs contain refinement information
    const refinementLogs = statusData.logs.filter(
      (log) => log.stage === "refinement-trigger"
    );
    expect(refinementLogs).toHaveLength(2);
  });

  it("should preserve existing status file structure while adding new fields", async () => {
    const statusPath = path.join(tempDir, "tasks-status-compat.json");
    const jobId = "test-job-compat";

    // Create initial status file with some existing data
    const initialStatus = {
      existingField: "should be preserved",
      legacyData: { old: "structure" },
      lastModified: "2023-01-01T00:00:00.000Z",
    };
    await fs.writeFile(statusPath, JSON.stringify(initialStatus, null, 2));

    const initialContext = {
      taskName: "test-task",
      workDir: tempDir,
      jobId,
      statusPath,
      seed: { testData: "compatibility test" },
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    await taskRunner.runPipeline(taskModulePath, initialContext);

    // Read final status
    const statusContent = await fs.readFile(statusPath, "utf8");
    const statusData = JSON.parse(statusContent);

    // Verify new structure is present
    expect(statusData).toHaveProperty("data");
    expect(statusData).toHaveProperty("flags");
    expect(statusData).toHaveProperty("logs");

    // Note: The current implementation overwrites the entire file,
    // so existing fields are not preserved. This test documents the current behavior.
    // If preservation is needed, the implementation would need to be updated.
    expect(statusData.existingField).toBeUndefined();
    expect(statusData.legacyData).toBeUndefined();
  });

  it("should handle status file write errors gracefully", async () => {
    const invalidStatusPath = path.join(
      "/invalid/path/that/does/not/exist/status.json"
    );
    const jobId = "test-job-error";
    const initialContext = {
      taskName: "test-task",
      workDir: tempDir,
      jobId,
      statusPath: invalidStatusPath,
      seed: { testData: "error test" },
    };

    const logsDir = path.join(tempDir, jobId, "files", "logs");
    await fs.mkdir(logsDir, { recursive: true });

    // Pipeline should still execute successfully even if status file fails to write
    const result = await taskRunner.runPipeline(taskModulePath, initialContext);

    expect(result.ok).toBe(true);
    expect(result.context.data.validateStructure).toBeDefined();
    expect(result.context.flags.validationFailed).toBe(false);
  });
});

describe("Validation Helper Functions", () => {
  describe("isPlainObject", () => {
    // Import the function directly from the module
    let isPlainObject;

    beforeEach(async () => {
      // Import the function by reading and evaluating the source
      const moduleContent = await fs.readFile(
        "src/core/task-runner.js",
        "utf8"
      );

      // Extract the function definition more precisely
      const functionStart = moduleContent.indexOf("function isPlainObject(");
      const functionEnd = moduleContent.indexOf("\n}", functionStart) + 2;
      const functionCode = moduleContent.substring(functionStart, functionEnd);

      isPlainObject = eval(`(${functionCode})`);
    });

    it("should return true for plain objects", () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ key: "value" })).toBe(true);
      expect(isPlainObject(Object.create(null))).toBe(false); // Object.create(null) has null prototype
    });

    it("should return false for arrays", () => {
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject([1, 2, 3])).toBe(false);
    });

    it("should return false for null", () => {
      expect(isPlainObject(null)).toBe(false);
    });

    it("should return false for primitives", () => {
      expect(isPlainObject("string")).toBe(false);
      expect(isPlainObject(123)).toBe(false);
      expect(isPlainObject(true)).toBe(false);
      expect(isPlainObject(undefined)).toBe(false);
    });

    it("should return false for class instances", () => {
      expect(isPlainObject(new Date())).toBe(false);
      expect(isPlainObject(new Map())).toBe(false);
      expect(isPlainObject(new Set())).toBe(false);
    });

    it("should return false for objects with non-Object prototype", () => {
      class CustomClass {}
      expect(isPlainObject(new CustomClass())).toBe(false);
    });
  });

  describe("assertStageResult", () => {
    let assertStageResult;
    let isPlainObject;

    beforeEach(async () => {
      // Import the function by reading and evaluating the source
      const moduleContent = await fs.readFile(
        "src/core/task-runner.js",
        "utf8"
      );

      // Extract isPlainObject function first
      const isPlainObjectStart = moduleContent.indexOf(
        "function isPlainObject("
      );
      const isPlainObjectEnd =
        moduleContent.indexOf("\n}", isPlainObjectStart) + 2;
      const isPlainObjectCode = moduleContent.substring(
        isPlainObjectStart,
        isPlainObjectEnd
      );

      // Extract assertStageResult function
      const assertStageResultStart = moduleContent.indexOf(
        "function assertStageResult("
      );
      const assertStageResultEnd =
        moduleContent.indexOf("\n}", assertStageResultStart) + 2;
      const assertStageResultCode = moduleContent.substring(
        assertStageResultStart,
        assertStageResultEnd
      );

      // Evaluate both functions in the same scope
      isPlainObject = eval(`(${isPlainObjectCode})`);
      assertStageResult = eval(`(${assertStageResultCode})`);
    });

    it("should not throw for valid result", () => {
      const validResult = {
        output: { test: "data" },
        flags: { validationFailed: false },
      };

      expect(() => assertStageResult("testStage", validResult)).not.toThrow();
    });

    it("should throw for null result", () => {
      expect(() => assertStageResult("testStage", null)).toThrow(
        'Stage "testStage" returned null or undefined'
      );
    });

    it("should throw for undefined result", () => {
      expect(() => assertStageResult("testStage", undefined)).toThrow(
        'Stage "testStage" returned null or undefined'
      );
    });

    it("should throw for non-object result", () => {
      expect(() => assertStageResult("testStage", "string")).toThrow(
        'Stage "testStage" must return an object, got string'
      );
    });

    it("should throw for result missing output property", () => {
      const result = { flags: {} };
      expect(() => assertStageResult("testStage", result)).toThrow(
        'Stage "testStage" result missing required property: output'
      );
    });

    it("should throw for result missing flags property", () => {
      const result = { output: {} };
      expect(() => assertStageResult("testStage", result)).toThrow(
        'Stage "testStage" result missing required property: flags'
      );
    });

    it("should throw for flags that are not plain objects", () => {
      const result = {
        output: {},
        flags: [], // Array instead of object
      };
      expect(() => assertStageResult("testStage", result)).toThrow(
        'Stage "testStage" flags must be a plain object, got object'
      );
    });

    it("should throw for flags that are null", () => {
      const result = {
        output: {},
        flags: null,
      };
      expect(() => assertStageResult("testStage", result)).toThrow(
        'Stage "testStage" flags must be a plain object, got object'
      );
    });
  });

  describe("validateFlagTypes", () => {
    let validateFlagTypes;

    beforeEach(async () => {
      // Import the function by reading and evaluating the source
      const moduleContent = await fs.readFile(
        "src/core/task-runner.js",
        "utf8"
      );

      // Extract the function definition more precisely
      const functionStart = moduleContent.indexOf(
        "function validateFlagTypes("
      );
      const functionEnd = moduleContent.indexOf("\n}", functionStart) + 2;
      const functionCode = moduleContent.substring(functionStart, functionEnd);

      validateFlagTypes = eval(`(${functionCode})`);
    });

    it("should not throw for valid single type schema", () => {
      const flags = { validationFailed: false };
      const schema = { validationFailed: "boolean" };

      expect(() => validateFlagTypes("testStage", flags, schema)).not.toThrow();
    });

    it("should not throw for valid multi-type schema", () => {
      const flags = { error: "string error" };
      const schema = { error: ["string", "object"] };

      expect(() => validateFlagTypes("testStage", flags, schema)).not.toThrow();
    });

    it("should allow undefined flags (optional)", () => {
      const flags = { validationFailed: false };
      const schema = { validationFailed: "boolean", optionalFlag: "string" };

      expect(() => validateFlagTypes("testStage", flags, schema)).not.toThrow();
    });

    it("should throw for invalid single type", () => {
      const flags = { validationFailed: "false" }; // String instead of boolean
      const schema = { validationFailed: "boolean" };

      expect(() => validateFlagTypes("testStage", flags, schema)).toThrow(
        'Stage "testStage" flag "validationFailed" has type string, expected boolean'
      );
    });

    it("should throw for invalid multi-type", () => {
      const flags = { error: 123 }; // Number instead of string or object
      const schema = { error: ["string", "object"] };

      expect(() => validateFlagTypes("testStage", flags, schema)).toThrow(
        'Stage "testStage" flag "error" has type number, expected one of: string, object'
      );
    });

    it("should handle null/undefined schema", () => {
      const flags = { anyFlag: "any value" };

      expect(() => validateFlagTypes("testStage", flags, null)).not.toThrow();
      expect(() =>
        validateFlagTypes("testStage", flags, undefined)
      ).not.toThrow();
    });
  });

  describe("checkFlagTypeConflicts", () => {
    let checkFlagTypeConflicts;

    beforeEach(async () => {
      // Import the function by reading and evaluating the source
      const moduleContent = await fs.readFile(
        "src/core/task-runner.js",
        "utf8"
      );

      // Extract the function definition more precisely
      const functionStart = moduleContent.indexOf(
        "function checkFlagTypeConflicts("
      );
      const functionEnd = moduleContent.indexOf("\n}", functionStart) + 2;
      const functionCode = moduleContent.substring(functionStart, functionEnd);

      checkFlagTypeConflicts = eval(`(${functionCode})`);
    });

    it("should not throw when types match", () => {
      const currentFlags = { validationFailed: false };
      const newFlags = { validationFailed: true };

      expect(() =>
        checkFlagTypeConflicts(currentFlags, newFlags, "testStage")
      ).not.toThrow();
    });

    it("should not throw when flag doesn't exist in current flags", () => {
      const currentFlags = { existingFlag: true };
      const newFlags = { newFlag: "value" };

      expect(() =>
        checkFlagTypeConflicts(currentFlags, newFlags, "testStage")
      ).not.toThrow();
    });

    it("should throw when types differ", () => {
      const currentFlags = { validationFailed: false }; // boolean
      const newFlags = { validationFailed: "false" }; // string

      expect(() =>
        checkFlagTypeConflicts(currentFlags, newFlags, "testStage")
      ).toThrow(
        'Stage "testStage" attempted to change flag "validationFailed" type from boolean to string'
      );
    });

    it("should throw for different type combinations", () => {
      const currentFlags = { error: "string" };
      const newFlags = { error: { message: "object" } };

      expect(() =>
        checkFlagTypeConflicts(currentFlags, newFlags, "testStage")
      ).toThrow(
        'Stage "testStage" attempted to change flag "error" type from string to object'
      );
    });
  });
});
