import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  FLAG_SCHEMAS,
  VALIDATION_STAGES,
  deriveModelKeyAndTokens,
  normalizeError,
  assertStageResult,
  validateFlagTypes,
  checkFlagTypeConflicts,
  captureConsoleOutput,
  createPipelineStages,
  runPipeline,
  runPipelineWithModelRouting,
  decideTransition,
  KNOWN_STAGES,
} from "../../src/core/task-runner";
import type {
  StageContext,
  StageResult,
  StageHandler,
  PipelineResult,
  PipelineSuccess,
  PipelineFailure,
  InitialContext,
} from "../../src/core/task-runner";

describe("FLAG_SCHEMAS", () => {
  test('has a "validateQuality" entry', () => {
    expect(FLAG_SCHEMAS["validateQuality"]).toBeDefined();
  });

  test('"validateQuality" has requires: {}', () => {
    expect(FLAG_SCHEMAS["validateQuality"]?.requires).toEqual({});
  });

  test('"validateQuality" produces: { needsRefinement: "boolean" }', () => {
    expect(FLAG_SCHEMAS["validateQuality"]?.produces).toEqual({ needsRefinement: "boolean" });
  });
});

describe("VALIDATION_STAGES", () => {
  test('contains "validateStructure"', () => {
    expect(VALIDATION_STAGES.has("validateStructure")).toBe(true);
  });

  test('contains "validateQuality"', () => {
    expect(VALIDATION_STAGES.has("validateQuality")).toBe(true);
  });

  test('contains "finalValidation"', () => {
    expect(VALIDATION_STAGES.has("finalValidation")).toBe(true);
  });
});

describe("deriveModelKeyAndTokens", () => {
  test("uses metadata.alias as model key when present", () => {
    const [key] = deriveModelKeyAndTokens({ metadata: { alias: "gpt-4" } });
    expect(key).toBe("gpt-4");
  });

  test("constructs provider:model key when no alias", () => {
    const [key] = deriveModelKeyAndTokens({ provider: "anthropic", model: "claude-3" });
    expect(key).toBe("anthropic:claude-3");
  });

  test("uses undefined:undefined when provider and model are missing", () => {
    const [key] = deriveModelKeyAndTokens({});
    expect(key).toBe("undefined:undefined");
  });

  test("returns correct token counts", () => {
    const result = deriveModelKeyAndTokens({
      provider: "anthropic",
      model: "claude-3",
      promptTokens: 100,
      completionTokens: 50,
    });
    expect(result[1]).toBe(100);
    expect(result[2]).toBe(50);
  });

  test("defaults promptTokens to 0 when NaN", () => {
    const [, inputTokens] = deriveModelKeyAndTokens({ promptTokens: NaN });
    expect(inputTokens).toBe(0);
  });

  test("defaults promptTokens to 0 when Infinity", () => {
    const [, inputTokens] = deriveModelKeyAndTokens({ promptTokens: Infinity });
    expect(inputTokens).toBe(0);
  });

  test("defaults token counts to 0 when fields are missing", () => {
    const [, inputTokens, outputTokens] = deriveModelKeyAndTokens({});
    expect(inputTokens).toBe(0);
    expect(outputTokens).toBe(0);
  });
});

describe("normalizeError", () => {
  test("normalizes an Error instance", () => {
    const err = new Error("boom");
    const result = normalizeError(err);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
    expect(typeof result.stack).toBe("string");
  });

  test("normalizes a string error", () => {
    const result = normalizeError("string error");
    expect(result.message).toBe("string error");
    expect(result.name).toBeUndefined();
    expect(result.stack).toBeUndefined();
  });

  test("normalizes a plain object with message and status", () => {
    const result = normalizeError({ message: "api fail", status: 429 });
    expect(result.message).toBe("api fail");
    expect(result.status).toBe(429);
  });

  test("JSON-stringifies a nested error object", () => {
    const result = normalizeError({ error: { message: "nested" } });
    expect(result.error).toBe('{"message":"nested"}');
  });

  test("normalizes an Error with extra status and code fields", () => {
    const err = Object.assign(new Error("oops"), { status: 500, code: "INTERNAL" });
    const result = normalizeError(err);
    expect(result.status).toBe(500);
    expect(result.code).toBe("INTERNAL");
  });

  test("normalizes a non-string, non-object, non-Error value", () => {
    const result = normalizeError(42);
    expect(result.message).toBe("42");
  });
});

describe("assertStageResult", () => {
  test("does not throw for a valid StageResult", () => {
    expect(() => assertStageResult({ output: "x", flags: {} }, "test")).not.toThrow();
  });

  test("throws when output is missing", () => {
    expect(() => assertStageResult({ flags: {} }, "test")).toThrow(/missing own property "output"/);
  });

  test("throws when flags is an array", () => {
    expect(() => assertStageResult({ output: "x", flags: [] }, "test")).toThrow(/array/);
  });

  test("throws when flags is null", () => {
    expect(() => assertStageResult({ output: "x", flags: null }, "test")).toThrow();
  });

  test("throws when result is not an object", () => {
    expect(() => assertStageResult("not an object", "test")).toThrow(/non-object/);
  });

  test("throws when flags property is missing", () => {
    expect(() => assertStageResult({ output: "x" }, "test")).toThrow(/missing own property "flags"/);
  });
});

describe("validateFlagTypes", () => {
  test("does not throw for a valid produced flag", () => {
    expect(() =>
      validateFlagTypes("validateQuality", { needsRefinement: true }, "produces"),
    ).not.toThrow();
  });

  test("throws when produced flag has wrong type", () => {
    expect(() =>
      validateFlagTypes("validateQuality", { needsRefinement: "yes" }, "produces"),
    ).toThrow(/expected boolean, got string/);
  });

  test("does not throw when stage has no schema entry", () => {
    expect(() => validateFlagTypes("ingestion", {}, "requires")).not.toThrow();
  });
});

describe("checkFlagTypeConflicts", () => {
  test("does not throw when new flag has the same type as existing", () => {
    expect(() =>
      checkFlagTypeConflicts({ needsRefinement: true }, { needsRefinement: false }),
    ).not.toThrow();
  });

  test("throws when new flag has a different type than existing", () => {
    expect(() =>
      checkFlagTypeConflicts({ needsRefinement: true }, { needsRefinement: "yes" }),
    ).toThrow(/type conflict/);
  });

  test("does not throw when the key does not exist in existing flags", () => {
    expect(() => checkFlagTypeConflicts({}, { newFlag: 42 })).not.toThrow();
  });
});

describe("captureConsoleOutput", () => {
  test("writes captured console output to the log file with correct prefixes", async () => {
    const logPath = join(tmpdir(), "task-runner-test", randomUUID(), "output.log");
    const restore = captureConsoleOutput(logPath);

    console.log("hello");
    console.error("err");

    await restore();

    const content = await Bun.file(logPath).text();
    expect(content).toBe("hello\n[ERROR] err\n");
  });

  test("restores original console.log after restore is called", async () => {
    const logPath = join(tmpdir(), "task-runner-test", randomUUID(), "output.log");
    const originalLog = console.log;

    const restore = captureConsoleOutput(logPath);
    expect(console.log).not.toBe(originalLog);

    await restore();

    expect(console.log).toBe(originalLog);
  });

  test("restores console even when an error is thrown during capture", async () => {
    const logPath = join(tmpdir(), "task-runner-test", randomUUID(), "output.log");
    const originalLog = console.log;

    const restore = captureConsoleOutput(logPath);
    try {
      try {
        throw new Error("simulated failure");
      } finally {
        await restore();
      }
    } catch {
      // expected — the error is still thrown after finally
    }

    expect(console.log).toBe(originalLog);
  });
});

describe("createPipelineStages", () => {
  const noopHandler: StageHandler = async (_ctx: StageContext): Promise<StageResult> => ({
    output: null,
    flags: {},
  });

  test("sets handlers for stages present in the task module", () => {
    const stages = createPipelineStages({ ingestion: noopHandler, inference: noopHandler });
    const ingestion = stages.find((s) => s.name === "ingestion");
    const inference = stages.find((s) => s.name === "inference");
    expect(ingestion?.handler).toBe(noopHandler);
    expect(inference?.handler).toBe(noopHandler);
  });

  test("sets handler to null for stages absent from the task module", () => {
    const stages = createPipelineStages({ ingestion: noopHandler });
    const preProcessing = stages.find((s) => s.name === "preProcessing");
    const promptTemplating = stages.find((s) => s.name === "promptTemplating");
    expect(preProcessing?.handler).toBeNull();
    expect(promptTemplating?.handler).toBeNull();
  });

  test("sets handler to null when module value is not a function", () => {
    const stages = createPipelineStages({ ingestion: "not-a-function" });
    const ingestion = stages.find((s) => s.name === "ingestion");
    expect(ingestion?.handler).toBeNull();
  });

  test("critique has skipIf that returns true when needsRefinement is not true", () => {
    const stages = createPipelineStages({});
    const critique = stages.find((s) => s.name === "critique");
    expect(critique?.skipIf).not.toBeNull();
    expect(critique?.skipIf?.({ needsRefinement: false })).toBe(true);
    expect(critique?.skipIf?.({ needsRefinement: "yes" })).toBe(true);
    expect(critique?.skipIf?.({})).toBe(true);
  });

  test("critique has skipIf that returns false when needsRefinement is true", () => {
    const stages = createPipelineStages({});
    const critique = stages.find((s) => s.name === "critique");
    expect(critique?.skipIf?.({ needsRefinement: true })).toBe(false);
  });

  test("refine has skipIf that returns true when needsRefinement is not true", () => {
    const stages = createPipelineStages({});
    const refine = stages.find((s) => s.name === "refine");
    expect(refine?.skipIf?.({ needsRefinement: false })).toBe(true);
    expect(refine?.skipIf?.({ needsRefinement: true })).toBe(false);
  });

  test("finalValidation has skipIf that returns true when needsRefinement is not true", () => {
    const stages = createPipelineStages({});
    const finalValidation = stages.find((s) => s.name === "finalValidation");
    expect(finalValidation?.skipIf?.({ needsRefinement: undefined })).toBe(true);
    expect(finalValidation?.skipIf?.({ needsRefinement: true })).toBe(false);
  });

  test("non-refinement stages have null skipIf", () => {
    const stages = createPipelineStages({});
    const nonRefinement = stages.filter(
      (s) => s.name !== "critique" && s.name !== "refine" && s.name !== "finalValidation",
    );
    for (const stage of nonRefinement) {
      expect(stage.skipIf).toBeNull();
    }
  });

  test("tasksOverride takes precedence over module exports", () => {
    const moduleHandler: StageHandler = async () => ({ output: "module", flags: {} });
    const overrideHandler: StageHandler = async () => ({ output: "override", flags: {} });
    const stages = createPipelineStages(
      { ingestion: moduleHandler },
      { ingestion: overrideHandler },
    );
    const ingestion = stages.find((s) => s.name === "ingestion");
    expect(ingestion?.handler).toBe(overrideHandler);
  });

  test("tasksOverride can provide a handler for a stage not in module", () => {
    const overrideHandler: StageHandler = async () => ({ output: null, flags: {} });
    const stages = createPipelineStages({}, { inference: overrideHandler });
    const inference = stages.find((s) => s.name === "inference");
    expect(inference?.handler).toBe(overrideHandler);
  });

  test("two calls return distinct array instances", () => {
    const stagesA = createPipelineStages({});
    const stagesB = createPipelineStages({});
    expect(stagesA).not.toBe(stagesB);
  });
});

// ─── runPipeline integration tests ──────────────────────────────────────────

describe("runPipeline", () => {
  let testDir: string;
  let modulePath: string;
  let statusPath: string;

  /** Writes a temporary task module to disk and returns its absolute path. */
  async function writeTaskModule(code: string): Promise<string> {
    const modPath = join(testDir, `task-module-${randomUUID()}.ts`);
    await Bun.write(modPath, code);
    return modPath;
  }

  /** Creates a minimal InitialContext that bypasses env loading and LLM creation. */
  function makeContext(overrides: Partial<InitialContext> = {}): InitialContext {
    return {
      workDir: testDir,
      taskName: "test-task",
      statusPath,
      envLoaded: true,
      llm: { chat: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }) } as unknown as InitialContext["llm"],
      ...overrides,
    } as InitialContext;
  }

  beforeEach(async () => {
    testDir = join(tmpdir(), "task-runner-integration", randomUUID());
    await mkdir(testDir, { recursive: true });
    statusPath = join(testDir, "tasks-status.json");
    // Write a default status file so writeJobStatus can read it
    await Bun.write(statusPath, JSON.stringify({
      id: "test",
      state: "pending",
      current: null,
      currentStage: null,
      lastUpdated: new Date().toISOString(),
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    }, null, 2));
  });

  test("succeeds with ingestion and inference handlers, populating context.data", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: { raw: "ingested-data" }, flags: { ingested: true } };
      }
      export async function inference(ctx) {
        return { output: { result: "inferred" }, flags: { inferred: true } };
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(true);
    const success = result as PipelineSuccess;
    expect(success.context.data["ingestion"]).toEqual({ raw: "ingested-data" });
    expect(success.context.data["inference"]).toEqual({ result: "inferred" });
    expect(success.context.flags["ingested"]).toBe(true);
    expect(success.context.flags["inferred"]).toBe(true);
  });

  test("stages without handlers are skipped with { stage, skipped: true } in logs", async () => {
    // Only provide an ingestion handler; all other stages have no handler
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: "data", flags: {} };
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(true);
    const skippedEntries = result.logs.filter(
      (l) => "skipped" in l && l.skipped === true,
    );
    // All stages except ingestion (and the 3 refinement stages which are skipIf'd) should be skipped
    expect(skippedEntries.length).toBeGreaterThan(0);
    // preProcessing should be in returned logs as skipped
    const preProcessingSkipped = result.logs.find(
      (l) => l.stage === "preProcessing" && "skipped" in l,
    );
    expect(preProcessingSkipped).toBeDefined();
  });

  test("throws when workDir is missing", async () => {
    modulePath = await writeTaskModule(`export async function ingestion() { return { output: null, flags: {} }; }`);

    await expect(
      runPipeline(modulePath, {
        taskName: "test",
        statusPath: "/tmp/s.json",
        envLoaded: true,
      } as InitialContext),
    ).rejects.toThrow(/workDir/);
  });

  test("throws when modulePath is relative", async () => {
    await expect(
      runPipeline("relative/path/module.ts", makeContext()),
    ).rejects.toThrow(/absolute/);
  });

  test("handler that throws produces { ok: false, failedStage, error } with debug metadata", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        throw new Error("ingestion-boom");
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(false);
    const failure = result as PipelineFailure;
    expect(failure.failedStage).toBe("ingestion");
    expect(failure.error.message).toBe("ingestion-boom");
    expect(failure.error.debug).toBeDefined();
    expect(failure.error.debug.stage).toBe("ingestion");
    expect(failure.error.debug.previousStage).toBe("seed");
    expect(Array.isArray(failure.error.debug.flagsKeys)).toBe(true);
  });

  test("handler returning { flags: [] } produces { ok: false } (invalid result shape)", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: "x", flags: [] };
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(false);
    const failure = result as PipelineFailure;
    expect(failure.failedStage).toBe("ingestion");
    expect(failure.error.message).toMatch(/array/);
  });

  test("seed defaults to initialContext when initialContext.seed is falsy", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: ctx.data.seed, flags: {} };
      }
    `);

    const ctx = makeContext();
    const result = await runPipeline(modulePath, ctx);

    expect(result.ok).toBe(true);
    const success = result as PipelineSuccess;
    // Since seed is falsy, context.data.seed should be the initialContext itself
    const seedData = success.context.data["seed"] as Record<string, unknown>;
    expect(seedData["taskName"]).toBe("test-task");
  });

  test("validation stages do not update the output thread", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: { step: "ingestion" }, flags: {} };
      }
      export async function validateStructure(ctx) {
        // This is a validation stage, output should not thread through
        return { output: { step: "validateStructure" }, flags: {} };
      }
      export async function inference(ctx) {
        // The output here should be from ingestion, not validateStructure
        return { output: { receivedOutput: ctx.output, step: "inference" }, flags: {} };
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(true);
    const success = result as PipelineSuccess;
    const inferenceOutput = success.context.data["inference"] as Record<string, unknown>;
    // The output threaded to inference should be from ingestion (last non-validation stage)
    const received = inferenceOutput["receivedOutput"] as Record<string, unknown>;
    expect(received["step"]).toBe("ingestion");
  });

  test("previousStage starts as seed and updates to last executed non-validation stage", async () => {
    let capturedPreviousStage = "";
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: "data", flags: {} };
      }
      export async function inference(ctx) {
        return { output: { prev: ctx.previousStage }, flags: {} };
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(true);
    const success = result as PipelineSuccess;
    const inferenceOutput = success.context.data["inference"] as Record<string, unknown>;
    expect(inferenceOutput["prev"]).toBe("ingestion");
  });

  test("skipIf stages are not in returned logs but are in context.logs", async () => {
    // critique, refine, finalValidation have skipIf that checks needsRefinement
    // When needsRefinement is not true, they are skipped via skipIf
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: "data", flags: {} };
      }
      export async function critique(ctx) {
        return { output: "critique-output", flags: {} };
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(true);
    const success = result as PipelineSuccess;

    // critique should be in context.logs as skipIf-skipped (not in returned logs)
    const critiqueInReturned = result.logs.find((l) => l.stage === "critique");
    expect(critiqueInReturned).toBeUndefined();

    const critiqueInContext = success.context.logs.find((l) => l.stage === "critique");
    expect(critiqueInContext).toBeDefined();
    expect("skipped" in critiqueInContext! && critiqueInContext.skipped).toBe(true);
  });

  test("flag type conflict causes pipeline failure", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: "data", flags: { myFlag: true } };
      }
      export async function inference(ctx) {
        // Return a string flag that conflicts with the boolean from ingestion
        return { output: "result", flags: { myFlag: "string-value" } };
      }
    `);

    const result = await runPipeline(modulePath, makeContext());

    expect(result.ok).toBe(false);
    const failure = result as PipelineFailure;
    expect(failure.failedStage).toBe("inference");
    expect(failure.error.message).toMatch(/type conflict/);
  });
});

// ─── runPipelineWithModelRouting integration tests ───────────────────────────

describe("runPipelineWithModelRouting", () => {
  let testDir: string;
  let modulePath: string;
  let statusPath: string;

  async function writeTaskModule(code: string): Promise<string> {
    const modPath = join(testDir, `task-module-${randomUUID()}.ts`);
    await Bun.write(modPath, code);
    return modPath;
  }

  function makeContext(overrides: Partial<InitialContext> = {}): InitialContext {
    return {
      workDir: testDir,
      taskName: "test-task",
      statusPath,
      envLoaded: true,
      llm: { chat: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }) } as unknown as InitialContext["llm"],
      ...overrides,
    } as InitialContext;
  }

  beforeEach(async () => {
    testDir = join(tmpdir(), "task-runner-model-routing", randomUUID());
    await mkdir(testDir, { recursive: true });
    statusPath = join(testDir, "tasks-status.json");
    await Bun.write(statusPath, JSON.stringify({
      id: "test",
      state: "pending",
      current: null,
      currentStage: null,
      lastUpdated: new Date().toISOString(),
      tasks: {},
      files: { artifacts: [], logs: [], tmp: [] },
    }, null, 2));
  });

  test("passes modelConfig fields into context.data.seed when modelConfig is provided", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: null, flags: {} };
      }
    `);

    const result = await runPipelineWithModelRouting(
      modulePath,
      makeContext(),
      { models: ["gpt-4", "claude-3"], defaultModel: "gpt-4" },
    );

    expect(result.ok).toBe(true);
    const success = result as PipelineSuccess;
    const seed = success.context.data["seed"] as Record<string, unknown>;
    expect(seed["availableModels"]).toEqual(["gpt-4", "claude-3"]);
    expect(seed["currentModel"]).toBe("gpt-4");
    expect((success.context.meta.modelConfig as Record<string, unknown> | undefined)?.["defaultModel"]).toBe("gpt-4");
  });

  test("uses default availableModels and currentModel when modelConfig is empty", async () => {
    modulePath = await writeTaskModule(`
      export async function ingestion(ctx) {
        return { output: null, flags: {} };
      }
    `);

    const result = await runPipelineWithModelRouting(
      modulePath,
      makeContext(),
      {},
    );

    expect(result.ok).toBe(true);
    const success = result as PipelineSuccess;
    const seed = success.context.data["seed"] as Record<string, unknown>;
    expect(seed["availableModels"]).toEqual(["default"]);
    expect(seed["currentModel"]).toBe("default");
  });
});

// ─── Re-exports ───────────────────────────────────────────────────────────────

describe("re-exports from task-runner", () => {
  test("decideTransition is a function", () => {
    expect(typeof decideTransition).toBe("function");
  });

  test("KNOWN_STAGES has 11 entries", () => {
    expect(KNOWN_STAGES.length).toBe(11);
  });
});
