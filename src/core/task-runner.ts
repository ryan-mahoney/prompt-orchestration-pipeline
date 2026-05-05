// ── src/core/task-runner.ts ──
// Single-task pipeline executor types, constants, and implementation.

import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { KNOWN_STAGES, computeDeterministicProgress } from "./progress";
import type { StageName } from "./progress";
import { createTaskFileIO, generateLogName, trackFile } from "./file-io";
import type { TaskFileIO } from "./file-io";
import { writeJobStatus } from "./status-writer";
import type { StatusSnapshot } from "./status-writer";
import { loadFreshModule } from "./module-loader";
import { loadEnvironment } from "./environment";
import { createJobLogger } from "./logger";
import { createHighLevelLLM, createLLMWithOverride, getLLMEvents } from "../llm/index";
import { TaskState } from "../config/statuses";
import { LogEvent, LogFileExtension } from "../config/log-events";
// LLMClient: src/llm/index.ts exports HighLevelLLM (no LLMClient type exists there).
import type { HighLevelLLM } from "../providers/types";

/** Opaque alias — the LLM client passed into execution contexts. */
export type LLMClient = HighLevelLLM;

/** Validation result returned by schema validators. */
export type { SchemaValidationResult } from "../api/validators/json";

/** Validation function injected into execution contexts. */
export type ValidateWithSchemaFn = (
  schema: unknown,
  data: unknown,
) => import("../api/validators/json").SchemaValidationResult;

// ─── Stage types ─────────────────────────────────────────────────────────────

/** Configuration for a single pipeline stage. */
export interface StageConfig {
  name: StageName;
  handler: StageHandler | null;
  skipIf: ((flags: Record<string, unknown>) => boolean) | null;
}

/** Function signature for a stage handler. */
export type StageHandler = (context: StageContext) => Promise<StageResult>;

/** Stage result contract — every handler must return this shape. */
export interface StageResult {
  output: unknown;
  flags: Record<string, unknown>;
}

// ─── Execution context ───────────────────────────────────────────────────────

/** Execution context created per runPipeline invocation. */
export interface ExecutionContext {
  io: TaskFileIO;
  llm: LLMClient;
  meta: ExecutionMeta;
  data: Record<string, unknown>;
  flags: Record<string, unknown>;
  logs: AuditLogEntry[];
  currentStage: StageName | null;
  validators: { validateWithSchema: ValidateWithSchemaFn };
}

/** Metadata shared across all stages within a single task run. */
export interface ExecutionMeta {
  taskName: string;
  workDir: string;
  statusPath: string;
  jobId: string | undefined;
  envLoaded: boolean;
  modelConfig: ModelConfig | undefined;
  pipelineTasks: string[] | undefined;
}

/** Model routing configuration. */
export interface ModelConfig {
  models?: string[];
  defaultModel?: string;
  [key: string]: unknown;
}

/** Context passed to each stage handler (cloned data/flags/output). */
export interface StageContext {
  io: TaskFileIO;
  llm: LLMClient;
  meta: ExecutionMeta;
  data: Record<string, unknown>;
  flags: Record<string, unknown>;
  currentStage: StageName;
  output: unknown;
  previousStage: string;
  validators: { validateWithSchema: ValidateWithSchemaFn };
}

// ─── Audit log ───────────────────────────────────────────────────────────────

/** Audit log entry for stage execution. */
export type AuditLogEntry =
  | { stage: string; ok: true; ms: number }
  | { stage: string; ok: false; ms: number; error: unknown }
  | { stage: string; skipped: true };

// ─── Pipeline result ─────────────────────────────────────────────────────────

/** Successful pipeline result. */
export interface PipelineSuccess {
  ok: true;
  logs: AuditLogEntry[];
  context: ExecutionContext;
  llmMetrics: LLMMetricRecord[];
}

/** Failed pipeline result. */
export interface PipelineFailure {
  ok: false;
  failedStage: string;
  error: NormalizedError;
  logs: AuditLogEntry[];
  context: ExecutionContext;
}

export type PipelineResult = PipelineSuccess | PipelineFailure;

// ─── Error types ─────────────────────────────────────────────────────────────

/** Normalized error envelope with debug metadata. */
export interface NormalizedError {
  name?: string;
  message: string;
  stack?: string;
  status?: unknown;
  code?: unknown;
  error?: string;
  debug: ErrorDebugInfo;
}

/** Debug metadata attached to normalized errors. */
export interface ErrorDebugInfo {
  stage: string;
  previousStage: string;
  logPath: string;
  snapshotPath: string;
  dataHasSeed: boolean;
  seedHasData: boolean;
  flagsKeys: string[];
}

// ─── LLM metrics ─────────────────────────────────────────────────────────────

/** LLM metric record accumulated during execution. */
export interface LLMMetricRecord {
  task?: string;
  stage?: string;
  failed?: true;
  [key: string]: unknown;
}

/** Token usage tuple written to the job status file. */
export type TokenUsageTuple = [modelKey: string, inputTokens: number, outputTokens: number, cost: number];

// ─── Initial context ─────────────────────────────────────────────────────────

/** Initial context provided by the caller (pipeline-runner). */
export interface InitialContext {
  workDir: string;
  taskName: string;
  statusPath: string;
  jobId?: string;
  envLoaded?: boolean;
  llm?: LLMClient;
  llmOverride?: unknown;
  seed?: unknown;
  modelConfig?: ModelConfig;
  pipelineTasks?: string[];
  tasksOverride?: Record<string, StageHandler>;
  meta?: { pipelineTasks?: string[] };
  [key: string]: unknown;
}

// ─── Flag schema ─────────────────────────────────────────────────────────────

/** Flag schema entry for a stage. */
export interface FlagSchema {
  requires: Record<string, string | string[]>;
  produces: Record<string, string | string[]>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Declared flag contracts per stage.
 * Only validateQuality has an entry; other stages have no declared contracts.
 * Flag type conflicts are caught at merge time for undeclared stages.
 */
export const FLAG_SCHEMAS: Record<string, FlagSchema> = {
  validateQuality: {
    requires: {},
    produces: { needsRefinement: "boolean" },
  },
} satisfies Record<string, FlagSchema>;

/**
 * Stages that do not update the output thread.
 * The `output` and `previousStage` fields passed to subsequent handlers
 * are not updated after these stages complete.
 */
export const VALIDATION_STAGES: ReadonlySet<string> = new Set([
  "validateStructure",
  "validateQuality",
  "finalValidation",
]);

// ─── Token usage ─────────────────────────────────────────────────────────────

/**
 * Derives the model key and token counts from a raw LLM metric record.
 * Uses `metadata.alias` as the model key when present;
 * otherwise constructs `"provider:model"` from the top-level fields.
 * Non-finite token counts default to 0.
 */
export function deriveModelKeyAndTokens(metric: Record<string, unknown>): TokenUsageTuple {
  const metadata = metric["metadata"];
  const alias =
    metadata !== null && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)["alias"]
      : undefined;

  const modelKey =
    typeof alias === "string" && alias.length > 0
      ? alias
      : `${String(metric["provider"] ?? "undefined")}:${String(metric["model"] ?? "undefined")}`;

  const prompt = metric["promptTokens"];
  const completion = metric["completionTokens"];

  const inputTokens = typeof prompt === "number" && Number.isFinite(prompt) ? prompt : 0;
  const outputTokens =
    typeof completion === "number" && Number.isFinite(completion) ? completion : 0;

  const rawCost = metric["cost"];
  const cost = typeof rawCost === "number" && Number.isFinite(rawCost) ? rawCost : 0;

  return [modelKey, inputTokens, outputTokens, cost];
}

// ─── Safe clone ─────────────────────────────────────────────────────────────

function safeClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

// ─── Error normalization ──────────────────────────────────────────────────────

/**
 * Normalizes an unknown thrown value into a partial NormalizedError (without debug).
 * - Error instances: extracts name, message, stack, and any status/code/error fields.
 * - Plain objects: extracts message, status, code, error fields.
 * - Strings: sets message to the string value.
 * - Other: sets message to String(err).
 */
export function normalizeError(err: unknown): Omit<NormalizedError, "debug"> {
  if (err instanceof Error) {
    const e = err as Error & { status?: unknown; code?: unknown; error?: unknown };
    const result: Omit<NormalizedError, "debug"> = { name: e.name, message: e.message };
    if (typeof e.stack === "string" && e.stack.trim().length > 0) {
      result.stack = e.stack;
    } else {
      // Some runtime errors (e.g., TimeoutError/DOMException) may carry an empty stack.
      // Synthesize one so downstream logs and UIs retain a traceback.
      const synthesized = new Error(`${e.name}: ${e.message}`).stack;
      if (typeof synthesized === "string" && synthesized.trim().length > 0) {
        result.stack = synthesized;
      }
    }
    if (e.status !== undefined) result.status = e.status;
    if (e.code !== undefined) result.code = e.code;
    if (e.error !== undefined) {
      result.error = typeof e.error === "string" ? e.error : JSON.stringify(e.error);
    }
    return result;
  }

  if (err !== null && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const message = typeof o["message"] === "string" ? o["message"] : String(err);
    const result: Omit<NormalizedError, "debug"> = { message };
    if (o["name"] !== undefined && typeof o["name"] === "string") result.name = o["name"];
    if (o["stack"] !== undefined && typeof o["stack"] === "string") result.stack = o["stack"];
    if (o["status"] !== undefined) result.status = o["status"];
    if (o["code"] !== undefined) result.code = o["code"];
    if (o["error"] !== undefined) {
      result.error = typeof o["error"] === "string" ? o["error"] : JSON.stringify(o["error"]);
    }
    return result;
  }

  if (typeof err === "string") {
    return { message: err };
  }

  return { message: String(err) };
}

// ─── Stage result assertion ───────────────────────────────────────────────────

/**
 * Asserts that `result` is a valid StageResult: a non-null object with own
 * properties `output` and `flags`, where `flags` is a plain object (not an
 * array, null, or class instance).
 * Throws a descriptive error if the shape is invalid.
 */
export function assertStageResult(
  result: unknown,
  stageName: string,
): asserts result is StageResult {
  if (result === null || typeof result !== "object") {
    throw new Error(`Stage "${stageName}" returned a non-object result: ${String(result)}`);
  }
  if (!Object.prototype.hasOwnProperty.call(result, "output")) {
    throw new Error(`Stage "${stageName}" result is missing own property "output"`);
  }
  if (!Object.prototype.hasOwnProperty.call(result, "flags")) {
    throw new Error(`Stage "${stageName}" result is missing own property "flags"`);
  }
  const flags = (result as Record<string, unknown>)["flags"];
  if (flags === null || typeof flags !== "object" || Array.isArray(flags)) {
    throw new Error(
      `Stage "${stageName}" result.flags must be a plain object, got: ${Array.isArray(flags) ? "array" : String(flags)}`,
    );
  }
  // Reject class instances (prototype is not Object.prototype)
  if (Object.getPrototypeOf(flags) !== Object.prototype) {
    throw new Error(
      `Stage "${stageName}" result.flags must be a plain object, got a class instance`,
    );
  }
}

// ─── Flag validation ──────────────────────────────────────────────────────────

/**
 * Validates that each flag in `flags` matches the declared type in
 * `FLAG_SCHEMAS[stageName][mode]`. No-ops if the stage has no schema entry.
 * Throws a descriptive error on type mismatch.
 */
export function validateFlagTypes(
  stageName: string,
  flags: Record<string, unknown>,
  mode: "requires" | "produces",
): void {
  const schema = FLAG_SCHEMAS[stageName];
  if (schema === undefined) return;

  const declared = schema[mode];
  for (const [key, expectedType] of Object.entries(declared)) {
    if (!Object.prototype.hasOwnProperty.call(flags, key)) continue;
    const value = flags[key];
    const actual = typeof value;
    const expected = Array.isArray(expectedType) ? expectedType : [expectedType];
    if (!expected.includes(actual)) {
      throw new Error(
        `Flag "${key}" for stage "${stageName}" (${mode}): expected ${expected.join(" | ")}, got ${actual}`,
      );
    }
  }
}

/**
 * Checks that no flag in `newFlags` has a different type than the same key
 * already present in `existingFlags`. Throws on type conflict.
 */
export function checkFlagTypeConflicts(
  existingFlags: Record<string, unknown>,
  newFlags: Record<string, unknown>,
): void {
  for (const [key, newValue] of Object.entries(newFlags)) {
    if (!Object.prototype.hasOwnProperty.call(existingFlags, key)) continue;
    const existingType = typeof existingFlags[key];
    const newType = typeof newValue;
    if (existingType !== newType) {
      throw new Error(
        `Flag type conflict for "${key}": existing type is ${existingType}, new value type is ${newType}`,
      );
    }
  }
}

// ─── Console capture ──────────────────────────────────────────────────────────

/**
 * Replaces console.log/error/warn/info/debug with functions that write to a
 * string buffer with appropriate prefixes. Returns a restore function that
 * flushes the buffer to `logPath` via Bun.write() and restores originals.
 * Creates the log directory before capturing.
 */
export function captureConsoleOutput(logPath: string): () => Promise<void> {
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;
  const origDebug = console.debug;

  let buffer = "";

  const append = (prefix: string, args: unknown[]) => {
    buffer += prefix + args.map(String).join(" ") + "\n";
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log = (...args: any[]) => append("", args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = (...args: any[]) => append("[ERROR] ", args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.warn = (...args: any[]) => append("[WARN] ", args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.info = (...args: any[]) => append("[INFO] ", args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.debug = (...args: any[]) => append("[DEBUG] ", args);

  return async () => {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    console.info = origInfo;
    console.debug = origDebug;

    await mkdir(dirname(logPath), { recursive: true });
    await Bun.write(logPath, buffer);
  };
}

// ─── Pipeline stage factory ───────────────────────────────────────────────────

/** Stages that only run when `needsRefinement` is explicitly `true`. */
const REFINEMENT_STAGES: ReadonlySet<string> = new Set(["critique", "refine", "finalValidation"]);

const skipUnlessRefinement = (flags: Record<string, unknown>): boolean =>
  flags["needsRefinement"] !== true;

/**
 * Creates a fresh array of stage configurations for a single pipeline
 * invocation. Handlers are resolved from `tasksOverride` first, then from
 * `taskModule`. Stages not present in either source get a `null` handler.
 * `critique`, `refine`, and `finalValidation` are given a `skipIf` predicate
 * that skips them when `flags.needsRefinement` is not `true`.
 */
export function createPipelineStages(
  taskModule: Record<string, unknown>,
  tasksOverride?: Record<string, StageHandler>,
): StageConfig[] {
  return KNOWN_STAGES.map((name) => {
    const raw = tasksOverride?.[name] ?? taskModule[name];
    const handler = typeof raw === "function" ? (raw as StageHandler) : null;
    const skipIf = REFINEMENT_STAGES.has(name) ? skipUnlessRefinement : null;
    return { name, handler, skipIf };
  });
}

// ─── Schema validation ───────────────────────────────────────────────────────

import { validateWithSchema } from "../api/validators/json";

// ─── runPipeline ──────────────────────────────────────────────────────────────

export async function runPipeline(
  modulePath: string,
  initialContext: InitialContext = {} as InitialContext,
): Promise<PipelineResult> {
  // 1. Validate required fields
  if (!initialContext.workDir) throw new Error("initialContext.workDir is required");
  if (!initialContext.taskName) throw new Error("initialContext.taskName is required");
  if (!initialContext.statusPath) throw new Error("initialContext.statusPath is required");

  // 2. Validate absolute path
  if (!isAbsolute(modulePath)) throw new Error("modulePath must be an absolute path");

  const { workDir, taskName, statusPath } = initialContext;
  const jobDir = dirname(statusPath);
  const jobId = initialContext.jobId ?? "";

  // 3. Create logger
  const logger = createJobLogger("task-runner", jobId);

  // 4. Load environment if needed
  if (!initialContext.envLoaded) {
    await loadEnvironment();
  }

  // 5. Create or reuse LLM client
  let llm: LLMClient;
  if (initialContext.llm) {
    llm = initialContext.llm;
  } else if (initialContext.llmOverride) {
    const override = initialContext.llmOverride as { provider: string; model: string };
    llm = createLLMWithOverride(override as Parameters<typeof createLLMWithOverride>[0]);
  } else {
    llm = createHighLevelLLM();
  }

  // 6. Register LLM metric event listeners
  const llmMetrics: LLMMetricRecord[] = [];
  let tokenWriteQueue: Promise<void> = Promise.resolve();
  const events = getLLMEvents();

  const onComplete = (metric: Record<string, unknown>) => {
    const record: LLMMetricRecord = {
      ...metric,
      task: taskName,
      stage: context.currentStage ?? undefined,
    };
    llmMetrics.push(record);

    // Append token usage to status file, serialized via promise queue
    const tuple = deriveModelKeyAndTokens(metric);
    tokenWriteQueue = tokenWriteQueue.then(async () => {
      await writeJobStatus(jobDir, (snapshot: StatusSnapshot) => {
        const tasks = snapshot.tasks;
        if (!tasks[taskName]) tasks[taskName] = {};
        const task = tasks[taskName]!;
        const usage = (task.tokenUsage ?? []) as unknown[];
        usage.push(tuple);
        task.tokenUsage = usage;
      }).catch(() => {});
    });
  };

  const onError = (metric: Record<string, unknown>) => {
    llmMetrics.push({
      ...metric,
      task: taskName,
      stage: context.currentStage ?? undefined,
      failed: true,
    });
  };

  events.on("llm:request:complete", onComplete);
  events.on("llm:request:error", onError);

  // 7. Load task module
  const taskModule = await loadFreshModule(pathToFileURL(modulePath));

  // 8. Create per-invocation stage array
  const stages = createPipelineStages(taskModule, initialContext.tasksOverride);

  // 9. Create file I/O adapter
  let currentStageRef: StageName | null = null;
  const io = createTaskFileIO({
    workDir,
    taskName,
    getStage: () => currentStageRef ?? "",
    statusPath,
  });

  // 10. Build execution context
  const pipelineTasks = initialContext.pipelineTasks ?? initialContext.meta?.pipelineTasks;

  // Seed handling: if initialContext.seed is falsy, use initialContext itself.
  // JSON round-trip strips non-cloneable fields (functions, proxies) which matches
  // the original JS behavior and ensures structuredClone works later.
  const seedData = initialContext.seed || JSON.parse(JSON.stringify(initialContext));

  const context: ExecutionContext = {
    io,
    llm,
    meta: {
      taskName,
      workDir,
      statusPath,
      jobId: initialContext.jobId,
      envLoaded: true,
      modelConfig: initialContext.modelConfig,
      pipelineTasks,
    },
    data: {
      seed: seedData,
    },
    flags: {},
    logs: [],
    currentStage: null,
    validators: { validateWithSchema },
  };

  // 11. Ensure log directory exists
  const logsDir = join(workDir, "files", "logs");
  await mkdir(logsDir, { recursive: true });
  const registerStageLog = async (fileName: string): Promise<void> => {
    await trackFile(jobDir, "logs", fileName, taskName, true);
  };

  // Track returned logs (separate from context.logs)
  const returnedLogs: AuditLogEntry[] = [];
  let lastStageOutput: unknown = context.data["seed"];
  let previousStage = "seed";

  // 12. Execute each stage sequentially
  for (const stage of stages) {
    const stageName = stage.name;

    // Check skipIf -> skip if true (log to context.logs only)
    if (stage.skipIf && stage.skipIf(context.flags)) {
      context.logs.push({ stage: stageName, skipped: true });
      continue;
    }

    // Check handler -> skip if null (log to returned logs)
    if (stage.handler === null) {
      returnedLogs.push({ stage: stageName, skipped: true });
      continue;
    }

    // Capture console output
    const logFileName = generateLogName(taskName, stageName, LogEvent.START, LogFileExtension.TEXT);
    const logPath = join(logsDir, logFileName);
    const restoreConsole = captureConsoleOutput(logPath);

    let stageError: { err: unknown } | null = null;

    try {
      // Set currentStage
      context.currentStage = stageName;
      currentStageRef = stageName;

      // Write stage-start status (swallow errors)
      try {
        await writeJobStatus(jobDir, (snapshot: StatusSnapshot) => {
          if (!snapshot.tasks[taskName]) snapshot.tasks[taskName] = {};
          snapshot.tasks[taskName]!.state = TaskState.RUNNING;
          snapshot.tasks[taskName]!.currentStage = stageName;
        });
      } catch {
        // Best-effort: swallow status write errors
      }

      // Clone data, flags, output into StageContext.
      // structuredClone throws on non-cloneable values (functions, streams,
      // class instances with internal slots). Fall back to JSON round-trip
      // which silently strips those fields.
      const stageContext: StageContext = {
        io,
        llm,
        meta: context.meta,
        data: safeClone(context.data),
        flags: safeClone(context.flags),
        currentStage: stageName,
        output: safeClone(lastStageOutput),
        previousStage,
        validators: context.validators,
      };

      // Write context snapshot
      const snapshotFileName = generateLogName(
        taskName,
        stageName,
        LogEvent.CONTEXT,
        LogFileExtension.JSON,
      );
      const snapshotPath = join(logsDir, snapshotFileName);
      try {
        await Bun.write(snapshotPath, JSON.stringify(stageContext, null, 2));
        await registerStageLog(snapshotFileName);
      } catch {
        // Best-effort
      }

      // Validate prerequisite flags
      validateFlagTypes(stageName, context.flags, "requires");

      // Execute handler, time with performance.now()
      const t0 = performance.now();
      const result = await stage.handler(stageContext);
      const elapsed = performance.now() - t0;

      // Validate result shape
      assertStageResult(result, stageName);

      // Validate produced flag types
      validateFlagTypes(stageName, result.flags, "produces");

      // Check flag type conflicts
      checkFlagTypeConflicts(context.flags, result.flags);

      // Store output in context.data[stageName]
      context.data[stageName] = result.output;

      // Update lastStageOutput if not a validation stage
      if (!VALIDATION_STAGES.has(stageName)) {
        lastStageOutput = result.output;
        previousStage = stageName;
      }

      // Merge flags
      Object.assign(context.flags, result.flags);

      // Log completion audit entry
      const auditEntry: AuditLogEntry = { stage: stageName, ok: true, ms: elapsed };
      context.logs.push(auditEntry);
      returnedLogs.push(auditEntry);

      // Write stage-completion status (swallow errors)
      try {
        await writeJobStatus(jobDir, (snapshot: StatusSnapshot) => {
          if (!snapshot.tasks[taskName]) snapshot.tasks[taskName] = {};
          snapshot.tasks[taskName]!.currentStage = stageName;
        });
      } catch {
        // Best-effort
      }

      // Write completion log marker
      const completeFileName = generateLogName(
        taskName,
        stageName,
        LogEvent.COMPLETE,
        LogFileExtension.TEXT,
      );
      try {
        await Bun.write(join(logsDir, completeFileName), `Stage ${stageName} completed in ${elapsed.toFixed(1)}ms\n`);
        await registerStageLog(completeFileName);
      } catch {
        // Best-effort
      }
    } catch (err: unknown) {
      // 13. On stage error — capture error, let finally restore console
      stageError = { err };
    } finally {
      // Always restore console, regardless of success or failure
      await restoreConsole();
      await registerStageLog(logFileName).catch(() => {});
    }

    if (stageError !== null) {
      const { err } = stageError;
      const base = normalizeError(err);
      const logFileName2 = generateLogName(taskName, stageName, LogEvent.START, LogFileExtension.TEXT);
      const snapshotFileName2 = generateLogName(taskName, stageName, LogEvent.CONTEXT, LogFileExtension.JSON);

      const normalized: NormalizedError = {
        ...base,
        debug: {
          stage: stageName,
          previousStage,
          logPath: join(logsDir, logFileName2),
          snapshotPath: join(logsDir, snapshotFileName2),
          dataHasSeed: "seed" in context.data,
          seedHasData: context.data["seed"] != null && typeof context.data["seed"] === "object" && "data" in (context.data["seed"] as Record<string, unknown>),
          flagsKeys: Object.keys(context.flags),
        },
      };

      const errorEntry: AuditLogEntry = { stage: stageName, ok: false, ms: 0, error: normalized };
      context.logs.push(errorEntry);
      returnedLogs.push(errorEntry);

      // Write failure status (swallow errors)
      try {
        await writeJobStatus(jobDir, (snapshot: StatusSnapshot) => {
          if (!snapshot.tasks[taskName]) snapshot.tasks[taskName] = {};
          snapshot.tasks[taskName]!.state = TaskState.FAILED;
          snapshot.tasks[taskName]!.failedStage = stageName;
          snapshot.tasks[taskName]!.error = normalized.message;
        });
      } catch {
        // Best-effort
      }

      // Flush token write queue
      await tokenWriteQueue.catch(() => {});

      // Remove LLM listeners
      events.removeListener("llm:request:complete", onComplete);
      events.removeListener("llm:request:error", onError);

      return {
        ok: false,
        failedStage: stageName,
        error: normalized,
        logs: returnedLogs,
        context,
      };
    }
  }

  // 14. After all stages: flush token write queue
  await tokenWriteQueue.catch(() => {});

  // Remove LLM listeners
  events.removeListener("llm:request:complete", onComplete);
  events.removeListener("llm:request:error", onError);

  // Write done status (best-effort)
  try {
    const lastStage = KNOWN_STAGES.at(-1)!;
    const doneProgress = computeDeterministicProgress(
      pipelineTasks ?? [taskName],
      taskName,
      lastStage,
    );
    await writeJobStatus(jobDir, (snapshot: StatusSnapshot) => {
      snapshot.progress = doneProgress;
      if (!snapshot.tasks[taskName]) snapshot.tasks[taskName] = {};
      snapshot.tasks[taskName]!.state = TaskState.DONE;
      snapshot.tasks[taskName]!.currentStage = null;
    });
  } catch {
    // Best-effort
  }

  context.currentStage = null;

  return {
    ok: true,
    logs: returnedLogs,
    context,
    llmMetrics,
  };
}

// ─── runPipelineWithModelRouting ──────────────────────────────────────────────

export async function runPipelineWithModelRouting(
  modulePath: string,
  initialContext: InitialContext = {} as InitialContext,
  modelConfig: ModelConfig = {},
): Promise<PipelineResult> {
  const availableModels = modelConfig.models ?? ["default"];
  const currentModel = modelConfig.defaultModel ?? "default";

  return runPipeline(modulePath, {
    ...initialContext,
    modelConfig,
    availableModels,
    currentModel,
  });
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { decideTransition } from "./lifecycle-policy";
export { computeDeterministicProgress, KNOWN_STAGES } from "./progress";
