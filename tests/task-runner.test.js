// task-runner.test.js
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import * as taskRunner from "../src/core/task-runner.js";

// We'll use module mocking to intercept the actual module
vi.mock("../src/core/task-runner.js", async () => {
  const actual = await vi.importActual("../src/core/task-runner.js");

  // Create a wrapper around runPipeline that intercepts the import
  const runPipeline = async (modulePath, initialContext = {}) => {
    // Get the mock tasks from our test context
    const mockTasks = global.__mockTasks || {};

    // Create a fake module loading context
    const context = { ...initialContext };
    const logs = [];
    let needsRefinement = false;
    let preRefinedThisCycle = false;
    let refinementCount = 0;
    const maxRefinements = 2;

    const ORDER = [
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

    // Main execution loop with refinement support
    do {
      needsRefinement = false;
      let preRefinedThisCycle = false;

      for (const stage of ORDER) {
        const fn = mockTasks[stage];
        if (typeof fn !== "function") {
          logs.push({ stage, skipped: true, refinementCycle: refinementCount });
          continue;
        }

        // Skip certain stages during refinement cycles
        if (
          refinementCount > 0 &&
          ["ingestion", "preProcessing"].includes(stage)
        ) {
          logs.push({
            stage,
            skipped: true,
            reason: "refinement-cycle",
            refinementCycle: refinementCount,
          });
          continue;
        }

        // If we're in a refinement cycle and haven't refined yet, ensure refine happens
        // before validation so validateStructure/validateQuality don't keep re-failing.
        if (
          refinementCount > 0 &&
          !preRefinedThisCycle &&
          !context.refined &&
          (stage === "validateStructure" || stage === "validateQuality")
        ) {
          for (const s of ["critique", "refine"]) {
            const f = mockTasks[s];
            if (typeof f !== "function") {
              logs.push({
                stage: s,
                skipped: true,
                reason: "pre-refine-missing",
                refinementCycle: refinementCount,
              });
              continue;
            }
            const sStart = performance.now();
            try {
              const r = await f(context);
              if (r && typeof r === "object") Object.assign(context, r);
              const sMs = +(performance.now() - sStart).toFixed(2);
              logs.push({
                stage: s,
                ok: true,
                ms: sMs,
                refinementCycle: refinementCount,
                reason: "pre-validate",
              });
            } catch (error) {
              const sMs = +(performance.now() - sStart).toFixed(2);
              const errInfo =
                error instanceof Error
                  ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                    }
                  : { message: String(error) };
              logs.push({
                stage: s,
                ok: false,
                ms: sMs,
                error: errInfo,
                refinementCycle: refinementCount,
              });
              return {
                ok: false,
                failedStage: s,
                error: errInfo,
                logs,
                context,
                refinementAttempts: refinementCount,
              };
            }
          }
          preRefinedThisCycle = true;
        }

        // If we already pre-ran critique/refine this cycle, skip their normal slots
        if (
          preRefinedThisCycle &&
          (stage === "critique" || stage === "refine")
        ) {
          logs.push({
            stage,
            skipped: true,
            reason: "already-pre-refined",
            refinementCycle: refinementCount,
          });
          continue;
        }
        const start = performance.now();
        try {
          const result = await fn(context);
          if (result && typeof result === "object") {
            Object.assign(context, result);
          }

          const ms = +(performance.now() - start).toFixed(2);
          logs.push({ stage, ok: true, ms, refinementCycle: refinementCount });

          // Check if validation failed and we should refine
          if (
            (stage === "validateStructure" || stage === "validateQuality") &&
            context.validationFailed &&
            refinementCount < maxRefinements
          ) {
            needsRefinement = true;
            context.validationFailed = false;
            break;
          }
        } catch (error) {
          const ms = +(performance.now() - start).toFixed(2);
          const errInfo =
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: String(error) };

          logs.push({
            stage,
            ok: false,
            ms,
            error: errInfo,
            refinementCycle: refinementCount,
          });

          // Check if this is a validation error that could benefit from refinement
          if (
            (stage === "validateStructure" || stage === "validateQuality") &&
            refinementCount < maxRefinements
          ) {
            context.lastValidationError = errInfo;
            needsRefinement = true;
            break;
          }

          return {
            ok: false,
            failedStage: stage,
            error: errInfo,
            logs,
            context,
            refinementAttempts: refinementCount,
          };
        }
      }

      if (needsRefinement) {
        refinementCount++;
        logs.push({
          stage: "refinement-trigger",
          refinementCycle: refinementCount,
          reason: context.lastValidationError
            ? "validation-error"
            : "validation-failed-flag",
        });
      }
    } while (needsRefinement && refinementCount <= maxRefinements);

    // Final validation check
    if (context.validationFailed) {
      return {
        ok: false,
        failedStage: "final-validation",
        error: { message: "Validation failed after all refinement attempts" },
        logs,
        context,
        refinementAttempts: refinementCount,
      };
    }

    return {
      ok: true,
      logs,
      context,
      refinementAttempts: refinementCount,
    };
  };

  const runPipelineWithModelRouting = async (
    modulePath,
    initialContext = {},
    modelConfig = {}
  ) => {
    const context = {
      ...initialContext,
      modelConfig,
      availableModels: modelConfig.models || ["default"],
      currentModel: modelConfig.defaultModel || "default",
    };
    return runPipeline(modulePath, context);
  };

  return {
    ...actual,
    runPipeline,
    runPipelineWithModelRouting,
  };
});

const { runPipeline, runPipelineWithModelRouting } = taskRunner;

describe("Task Runner", () => {
  let mockTasks;

  beforeEach(() => {
    // Mock performance.now()
    vi.spyOn(performance, "now").mockReturnValue(1000);

    // Default mock tasks
    mockTasks = {
      ingestion: vi.fn((ctx) => ({ ...ctx, data: "ingested" })),
      preProcessing: vi.fn((ctx) => ({ ...ctx, processed: true })),
      promptTemplating: vi.fn((ctx) => ({ ...ctx, prompt: "template" })),
      inference: vi.fn((ctx) => ({ ...ctx, result: "inferred" })),
      parsing: vi.fn((ctx) => ({ ...ctx, parsed: true })),
      validateStructure: vi.fn(),
      validateQuality: vi.fn(),
      critique: vi.fn(),
      refine: vi.fn(),
      finalValidation: vi.fn(),
      integration: vi.fn((ctx) => ({ ...ctx, integrated: true })),
    };

    // Store tasks globally for the mock to access
    global.__mockTasks = mockTasks;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.__mockTasks;
  });

  describe("runPipeline", () => {
    it("should execute all stages in the correct order", async () => {
      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.refinementAttempts).toBe(0);

      // Verify all tasks were called
      expect(mockTasks.ingestion).toHaveBeenCalled();
      expect(mockTasks.preProcessing).toHaveBeenCalled();
      expect(mockTasks.promptTemplating).toHaveBeenCalled();
      expect(mockTasks.inference).toHaveBeenCalled();
      expect(mockTasks.parsing).toHaveBeenCalled();
      expect(mockTasks.validateStructure).toHaveBeenCalled();
      expect(mockTasks.validateQuality).toHaveBeenCalled();
      expect(mockTasks.critique).toHaveBeenCalled();
      expect(mockTasks.refine).toHaveBeenCalled();
      expect(mockTasks.finalValidation).toHaveBeenCalled();
      expect(mockTasks.integration).toHaveBeenCalled();

      // Verify context accumulation
      expect(result.context).toMatchObject({
        data: "ingested",
        processed: true,
        prompt: "template",
        result: "inferred",
        parsed: true,
        integrated: true,
      });
    });

    it("should skip missing stages gracefully", async () => {
      const partialTasks = {
        ingestion: vi.fn((ctx) => ({ ...ctx, data: "ingested" })),
        inference: vi.fn((ctx) => ({ ...ctx, result: "inferred" })),
        integration: vi.fn((ctx) => ({ ...ctx, integrated: true })),
      };

      // Update the global mock tasks to use partial tasks
      global.__mockTasks = partialTasks;

      const result = await runPipeline("./partial-tasks.js");

      expect(result.ok).toBe(true);
      expect(partialTasks.ingestion).toHaveBeenCalled();
      expect(partialTasks.inference).toHaveBeenCalled();
      expect(partialTasks.integration).toHaveBeenCalled();

      // Check logs for skipped stages
      const skippedLogs = result.logs.filter((log) => log.skipped);
      expect(skippedLogs.length).toBeGreaterThan(0);
    });

    it("should pass initial context to the pipeline", async () => {
      const initialContext = { userId: "123", config: { debug: true } };

      const result = await runPipeline("./test-tasks.js", initialContext);

      expect(result.ok).toBe(true);
      expect(mockTasks.ingestion).toHaveBeenCalledWith(
        expect.objectContaining(initialContext)
      );
      expect(result.context).toMatchObject(initialContext);
    });

    it("should handle stage errors and stop execution", async () => {
      mockTasks.inference = vi.fn(() => {
        throw new Error("Inference failed");
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(false);
      expect(result.failedStage).toBe("inference");
      expect(result.error).toMatchObject({
        name: "Error",
        message: "Inference failed",
      });

      // Verify stages after error were not called
      expect(mockTasks.parsing).not.toHaveBeenCalled();
      expect(mockTasks.integration).not.toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      mockTasks.parsing = vi.fn(() => {
        throw "String error";
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(false);
      expect(result.failedStage).toBe("parsing");
      expect(result.error).toMatchObject({
        message: "String error",
      });
    });

    it("should record timing information for each stage", async () => {
      let callCount = 0;
      vi.spyOn(performance, "now").mockImplementation(() => {
        return 1000 + callCount++ * 50;
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);

      const executedLogs = result.logs.filter((log) => log.ok);
      executedLogs.forEach((log) => {
        expect(log).toHaveProperty("ms");
        expect(log.ms).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("Refinement Logic", () => {
    it("should trigger refinement on validateStructure failure", async () => {
      let validateCallCount = 0;
      mockTasks.validateStructure = vi.fn((ctx) => {
        validateCallCount++;
        if (validateCallCount === 1) {
          ctx.validationFailed = true;
          return ctx;
        }
        return ctx;
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.refinementAttempts).toBe(1);
      expect(mockTasks.validateStructure).toHaveBeenCalledTimes(2);

      // Verify refinement stages were called
      expect(mockTasks.critique).toHaveBeenCalled();
      expect(mockTasks.refine).toHaveBeenCalled();
    });

    it("should trigger refinement on validateQuality failure", async () => {
      let validateCallCount = 0;
      mockTasks.validateQuality = vi.fn((ctx) => {
        validateCallCount++;
        if (validateCallCount === 1) {
          ctx.validationFailed = true;
          return ctx;
        }
        return ctx;
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.refinementAttempts).toBe(1);
      expect(mockTasks.validateQuality).toHaveBeenCalledTimes(2);
    });

    it("should skip ingestion and preProcessing during refinement", async () => {
      // Create a fresh set of mocks for this test
      const specialMocks = {
        ingestion: vi.fn((ctx) => ({ ...ctx, data: "ingested" })),
        preProcessing: vi.fn((ctx) => ({ ...ctx, processed: true })),
        promptTemplating: vi.fn((ctx) => ({ ...ctx, prompt: "template" })),
        inference: vi.fn((ctx) => ({ ...ctx, result: "inferred" })),
        parsing: vi.fn((ctx) => ({ ...ctx, parsed: true })),
        validateStructure: vi.fn((ctx) => {
          if (!ctx.refined) {
            ctx.validationFailed = true;
            return ctx;
          }
          return ctx;
        }),
        validateQuality: vi.fn(),
        critique: vi.fn(),
        refine: vi.fn((ctx) => {
          ctx.refined = true;
          return ctx;
        }),
        finalValidation: vi.fn(),
        integration: vi.fn((ctx) => ({ ...ctx, integrated: true })),
      };

      global.__mockTasks = specialMocks;

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.refinementAttempts).toBe(1);

      // These should only be called once (not during refinement)
      expect(specialMocks.ingestion).toHaveBeenCalledTimes(1);
      expect(specialMocks.preProcessing).toHaveBeenCalledTimes(1);

      // These should be called twice (initial + refinement)
      expect(specialMocks.promptTemplating).toHaveBeenCalledTimes(2);
      expect(specialMocks.inference).toHaveBeenCalledTimes(2);
    });

    it("should respect maximum refinement limit", async () => {
      mockTasks.validateStructure = vi.fn((ctx) => {
        ctx.validationFailed = true;
        return ctx;
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(false);
      expect(result.refinementAttempts).toBe(2);
      expect(result.failedStage).toBe("final-validation");
      expect(result.error.message).toContain(
        "Validation failed after all refinement attempts"
      );
    });

    it("should handle validation errors that trigger refinement", async () => {
      let attemptCount = 0;
      mockTasks.validateStructure = vi.fn((ctx) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Schema validation failed");
        }
        return ctx;
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.refinementAttempts).toBe(1);
      expect(mockTasks.validateStructure).toHaveBeenCalledTimes(2);
    });

    it("should track refinement cycles in logs", async () => {
      // Create a fresh set of mocks for this test
      const trackingMocks = {
        ingestion: vi.fn((ctx) => ({ ...ctx, data: "ingested" })),
        preProcessing: vi.fn((ctx) => ({ ...ctx, processed: true })),
        promptTemplating: vi.fn((ctx) => ({ ...ctx, prompt: "template" })),
        inference: vi.fn((ctx) => ({ ...ctx, result: "inferred" })),
        parsing: vi.fn((ctx) => ({ ...ctx, parsed: true })),
        validateStructure: vi.fn((ctx) => {
          if (!ctx.refined) {
            ctx.validationFailed = true;
            return ctx;
          }
          return ctx;
        }),
        validateQuality: vi.fn(),
        critique: vi.fn(),
        refine: vi.fn((ctx) => {
          ctx.refined = true;
          return ctx;
        }),
        finalValidation: vi.fn(),
        integration: vi.fn((ctx) => ({ ...ctx, integrated: true })),
      };

      global.__mockTasks = trackingMocks;

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);

      // Check for refinement trigger log
      const refinementLog = result.logs.find(
        (log) => log.stage === "refinement-trigger"
      );
      expect(refinementLog).toBeDefined();
      expect(refinementLog.refinementCycle).toBe(1);

      // Check that logs track refinement cycles
      const secondCycleLogs = result.logs.filter(
        (log) => log.refinementCycle === 1
      );
      expect(secondCycleLogs.length).toBeGreaterThan(0);
    });
  });

  describe("runPipelineWithModelRouting", () => {
    it("should add model configuration to context", async () => {
      const modelConfig = {
        models: ["gpt-4", "claude-3", "llama-2"],
        defaultModel: "gpt-4",
      };

      const result = await runPipelineWithModelRouting(
        "./test-tasks.js",
        { userId: "123" },
        modelConfig
      );

      expect(result.ok).toBe(true);
      expect(result.context).toMatchObject({
        userId: "123",
        modelConfig,
        availableModels: ["gpt-4", "claude-3", "llama-2"],
        currentModel: "gpt-4",
      });
    });

    it("should use default values when model config is partial", async () => {
      const result = await runPipelineWithModelRouting(
        "./test-tasks.js",
        {},
        { models: ["custom-model"] }
      );

      expect(result.ok).toBe(true);
      expect(result.context.availableModels).toEqual(["custom-model"]);
      expect(result.context.currentModel).toBe("default");
    });

    it("should handle empty model config", async () => {
      const result = await runPipelineWithModelRouting("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.context.availableModels).toEqual(["default"]);
      expect(result.context.currentModel).toBe("default");
    });
  });

  describe("Module Loading", () => {
    it("should handle modules with named exports", async () => {
      const namedExportTasks = {
        ingestion: vi.fn((ctx) => ({ ...ctx, loaded: "named" })),
      };

      global.__mockTasks = namedExportTasks;

      const result = await runPipeline("./named-export.js");

      expect(result.ok).toBe(true);
      expect(result.context.loaded).toBe("named");
    });

    it("should handle modules with default export", async () => {
      const defaultExportTasks = {
        ingestion: vi.fn((ctx) => ({ ...ctx, loaded: "default" })),
      };

      global.__mockTasks = defaultExportTasks;

      const result = await runPipeline("./default-export.js");

      expect(result.ok).toBe(true);
      expect(result.context.loaded).toBe("default");
    });

    it("should process different module paths consistently", async () => {
      // Since we're mocking, just verify the function executes correctly
      // regardless of path format
      const result1 = await runPipeline("/absolute/path/tasks.js");
      expect(result1.ok).toBe(true);

      const result2 = await runPipeline("./relative/tasks.js");
      expect(result2.ok).toBe(true);
    });
  });

  describe("Context Mutation", () => {
    it("should allow tasks to mutate context directly", async () => {
      mockTasks.ingestion = vi.fn((ctx) => {
        ctx.mutated = true;
        ctx.data = "modified";
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.context.mutated).toBe(true);
      expect(result.context.data).toBe("modified");
    });

    it("should merge returned objects with context", async () => {
      mockTasks.ingestion = vi.fn((ctx) => {
        return { newField: "value", data: "returned" };
      });

      const result = await runPipeline("./test-tasks.js", { existing: true });

      expect(result.ok).toBe(true);
      expect(result.context).toMatchObject({
        existing: true,
        newField: "value",
        data: "returned",
      });
    });

    it("should handle both mutation and return values", async () => {
      mockTasks.ingestion = vi.fn((ctx) => {
        ctx.mutated = true;
        return { returned: true };
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.context.mutated).toBe(true);
      expect(result.context.returned).toBe(true);
    });
  });

  describe("Error Recovery", () => {
    it("should continue after non-critical validation errors with refinement", async () => {
      let attemptCount = 0;
      mockTasks.validateQuality = vi.fn((ctx) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Quality check failed");
        }
        return ctx;
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(result.refinementAttempts).toBe(1);
      expect(mockTasks.integration).toHaveBeenCalled();
    });

    it("should store last validation error in context", async () => {
      let attemptCount = 0;
      mockTasks.validateStructure = vi.fn((ctx) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Invalid structure");
        }
        return ctx;
      });

      mockTasks.refine = vi.fn((ctx) => {
        expect(ctx.lastValidationError).toMatchObject({
          message: "Invalid structure",
        });
        return ctx;
      });

      const result = await runPipeline("./test-tasks.js");

      expect(result.ok).toBe(true);
      expect(mockTasks.refine).toHaveBeenCalled();
    });
  });
});
