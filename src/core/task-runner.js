import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs";
import { createLLM, getLLMEvents } from "../llm/index.js";
import { loadFreshModule } from "./module-loader.js";
import { loadEnvironment } from "./environment.js";
import { createTaskFileIO } from "./file-io.js";
import { writeJobStatus } from "./status-writer.js";
import { computeDeterministicProgress } from "./progress.js";
import { TaskState } from "../config/statuses.js";
import { validateWithSchema } from "../api/validators/json.js";

/**
 * Derives model key and token counts from LLM metric event.
 * Returns a tuple: [modelKey, inputTokens, outputTokens].
 *
 * @param {Object} metric - The LLM metric event from llm:request:complete
 * @returns {Array<string, number, number>} [modelKey, inputTokens, outputTokens]
 */
export function deriveModelKeyAndTokens(metric) {
  const provider = metric?.provider || "undefined";
  const model = metric?.model || "undefined";
  const modelKey = metric?.metadata?.alias || `${provider}:${model}`;
  const input = Number.isFinite(metric?.promptTokens) ? metric.promptTokens : 0;
  const output = Number.isFinite(metric?.completionTokens)
    ? metric.completionTokens
    : 0;
  return [modelKey, input, output];
}

/**
 * Validates that a value is a plain object (not array, null, or class instance).
 * @param {*} value - The value to check
 * @returns {boolean} True if the value is a plain object, false otherwise
 */
function isPlainObject(value) {
  if (typeof value !== "object") {
    return false;
  }
  if (value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return true;
  }
  return false;
}

/**
 * Validates stage handler return values conform to { output, flags } contract.
 * @param {string} stageName - The name of the stage for error reporting
 * @param {*} result - The result returned by the stage handler
 * @throws {Error} If the result doesn't conform to the expected contract
 */
function assertStageResult(stageName, result) {
  if (result === null || result === undefined) {
    throw new Error(`Stage "${stageName}" returned null or undefined`);
  }

  if (typeof result !== "object") {
    throw new Error(
      `Stage "${stageName}" must return an object, got ${typeof result}`
    );
  }

  if (!result.hasOwnProperty("output")) {
    throw new Error(
      `Stage "${stageName}" result missing required property: output`
    );
  }

  if (!result.hasOwnProperty("flags")) {
    throw new Error(
      `Stage "${stageName}" result missing required property: flags`
    );
  }

  if (!isPlainObject(result.flags)) {
    throw new Error(
      `Stage "${stageName}" flags must be a plain object, got ${typeof result.flags}`
    );
  }
}

/**
 * Validates flag values match declared types in schema.
 * @param {string} stageName - The name of the stage for error reporting
 * @param {object} flags - The flags object to validate
 * @param {object} schema - The schema defining expected types for each flag
 * @throws {Error} If flag types don't match the schema
 */
function validateFlagTypes(stageName, flags, schema) {
  if (schema === undefined || schema === null) {
    return;
  }

  for (const key in schema) {
    const expectedTypes = schema[key];
    const actualType = typeof flags[key];

    // Allow undefined flags (they may be optional)
    if (flags[key] === undefined) {
      continue;
    }

    if (typeof expectedTypes === "string") {
      // Single expected type
      if (actualType !== expectedTypes) {
        throw new Error(
          `Stage "${stageName}" flag "${key}" has type ${actualType}, expected ${expectedTypes}`
        );
      }
    } else if (Array.isArray(expectedTypes)) {
      // Multiple allowed types
      if (!expectedTypes.includes(actualType)) {
        throw new Error(
          `Stage "${stageName}" flag "${key}" has type ${actualType}, expected one of: ${expectedTypes.join(", ")}`
        );
      }
    }
  }
}

/**
 * Detects type conflicts when merging new flags into existing flags.
 * @param {object} currentFlags - The existing flags object
 * @param {object} newFlags - The new flags to merge
 * @param {string} stageName - The name of the stage for error reporting
 * @throws {Error} If any flag would change type when merged
 */
function checkFlagTypeConflicts(currentFlags, newFlags, stageName) {
  for (const key of Object.keys(newFlags)) {
    if (key in currentFlags) {
      const currentType = typeof currentFlags[key];
      const newType = typeof newFlags[key];
      if (currentType !== newType) {
        throw new Error(
          `Stage "${stageName}" attempted to change flag "${key}" type from ${currentType} to ${newType}`
        );
      }
    }
  }
}

/**
 * Ensures log directory exists before creating log files.
 * @param {string} workDir - The working directory path
 * @param {string} jobId - The job ID
 * @returns {string} The full path to the logs directory
 */
function ensureLogDirectory(workDir, jobId) {
  const logsPath = path.join(workDir, "files", "logs");
  fs.mkdirSync(logsPath, { recursive: true });
  return logsPath;
}

/**
 * Redirects console output to a log file for a stage.
 * @param {string} logPath - The path to the log file
 * @returns {() => void} A function that restores console output and closes the log stream
 */
function captureConsoleOutput(logPath) {
  // Ensure the directory for the log file exists
  const logDir = path.dirname(logPath);
  fs.mkdirSync(logDir, { recursive: true });

  const logStream = fs.createWriteStream(logPath, { flags: "w" });

  // Store original console methods
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  // Override console methods to write to stream
  console.log = (...args) => logStream.write(args.join(" ") + "\n");
  console.error = (...args) =>
    logStream.write("[ERROR] " + args.join(" ") + "\n");
  console.warn = (...args) =>
    logStream.write("[WARN] " + args.join(" ") + "\n");
  console.info = (...args) =>
    logStream.write("[INFO] " + args.join(" ") + "\n");
  console.debug = (...args) =>
    logStream.write("[DEBUG] " + args.join(" ") + "\n");

  // Return restoration function
  return () => {
    logStream.end();
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
    console.debug = originalDebug;
  };
}

function readStatusSnapshot(statusPath) {
  try {
    if (!statusPath || !fs.existsSync(statusPath)) {
      return null;
    }
    const raw = fs.readFileSync(statusPath, "utf8");
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn(
      `[task-runner] Failed to read existing status file at ${statusPath}: ${error.message}`
    );
    return null;
  }
}

function mergeStatusSnapshot(existing, updates) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};

  if (updates?.data) {
    base.data = { ...(existing?.data || {}), ...updates.data };
  }
  if (updates?.flags) {
    base.flags = { ...(existing?.flags || {}), ...updates.flags };
  }
  if (Object.prototype.hasOwnProperty.call(updates || {}, "logs")) {
    base.logs = updates.logs;
  }

  for (const [key, value] of Object.entries(updates || {})) {
    if (key === "data" || key === "flags" || key === "logs") continue;
    base[key] = value;
  }

  return base;
}

function persistStatusSnapshot(statusPath, updates) {
  if (!statusPath || !updates) {
    return;
  }
  const existing = readStatusSnapshot(statusPath);
  const merged = mergeStatusSnapshot(existing, updates);
  fs.writeFileSync(statusPath, JSON.stringify(merged, null, 2));
}

/**
 * Flag schemas for each pipeline stage.
 * Defines required flags (prerequisites) and produced flags (outputs) with their types.
 */
const FLAG_SCHEMAS = {
  validateQuality: {
    requires: {},
    produces: {
      needsRefinement: "boolean",
    },
  },
};

/**
 * Canonical pipeline stage execution order for the modern pipeline.
 * Each stage defines its handler, skip predicate, and iteration limits.
 * Stages with missing handlers are automatically skipped during execution.
 * This is the single, unified pipeline with no legacy execution paths.
 */
const PIPELINE_STAGES = [
  {
    name: "ingestion",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "preProcessing",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "promptTemplating",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "inference",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "parsing",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "validateStructure",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "validateQuality",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "critique",
    handler: null, // Will be populated from dynamic module import
    skipIf: (flags) => flags.needsRefinement !== true,
    maxIterations: null,
  },
  {
    name: "refine",
    handler: null, // Will be populated from dynamic module import
    skipIf: (flags) => flags.needsRefinement !== true,
    maxIterations: null,
  },
  {
    name: "finalValidation",
    handler: null, // Will be populated from dynamic module import
    skipIf: (flags) => flags.needsRefinement !== true,
    maxIterations: null,
  },
  {
    name: "integration",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
];

/**
 * Runs a pipeline by loading a module that exports functions keyed by stage name.
 */
export async function runPipeline(modulePath, initialContext = {}) {
  if (!initialContext.envLoaded) {
    await loadEnvironment();
    initialContext.envLoaded = true;
  }

  if (!initialContext.llm) initialContext.llm = createLLM();

  const llmMetrics = [];
  const llmEvents = getLLMEvents();

  // Per-run write queue for serializing tokenUsage appends
  let tokenWriteQueue = Promise.resolve();

  /**
   * Appends token usage tuple to tasks-status.json with serialized writes.
   * @param {string} workDir - Working directory path
   * @param {string} taskName - Task identifier
   * @param {Array<string, number, number>} tuple - [modelKey, inputTokens, outputTokens]
   */
  function appendTokenUsage(workDir, taskName, tuple) {
    tokenWriteQueue = tokenWriteQueue
      .then(() =>
        writeJobStatus(workDir, (snapshot) => {
          if (!snapshot.tasks[taskName]) {
            snapshot.tasks[taskName] = {};
          }
          const task = snapshot.tasks[taskName];
          if (!Array.isArray(task.tokenUsage)) {
            task.tokenUsage = [];
          }
          task.tokenUsage.push(tuple);
          return snapshot;
        })
      )
      .catch((e) => console.warn("[task-runner] tokenUsage append failed:", e));
  }

  const onLLMComplete = (metric) => {
    llmMetrics.push({
      ...metric,
      task: context.meta.taskName,
      stage: context.currentStage,
    });

    // Append token usage immediately for each successful LLM completion
    if (context.meta.workDir && context.meta.taskName) {
      const tuple = deriveModelKeyAndTokens(metric);
      appendTokenUsage(context.meta.workDir, context.meta.taskName, tuple);
    }
  };

  llmEvents.on("llm:request:complete", onLLMComplete);
  llmEvents.on("llm:request:error", (m) =>
    llmMetrics.push({ ...m, failed: true })
  );

  const abs = toAbsFileURL(modulePath);
  const mod = await loadFreshModule(abs);
  const tasks = mod.default ?? mod;

  // Populate PIPELINE_STAGES handlers from dynamically loaded tasks or test override
  const handlersSource = initialContext.tasksOverride || tasks;
  PIPELINE_STAGES.forEach((stageConfig) => {
    if (
      handlersSource[stageConfig.name] &&
      typeof handlersSource[stageConfig.name] === "function"
    ) {
      stageConfig.handler = handlersSource[stageConfig.name];
    } else {
      // Set handler to null when not available - will be skipped
      stageConfig.handler = null;
    }
  });

  // fileIO is mandatory for runner execution
  if (
    !initialContext.workDir ||
    !initialContext.taskName ||
    !initialContext.statusPath
  ) {
    throw new Error(
      `fileIO is required for task execution but missing required context. workDir: ${initialContext.workDir}, taskName: ${initialContext.taskName}, statusPath: ${initialContext.statusPath}`
    );
  }

  const fileIO = createTaskFileIO({
    workDir: initialContext.workDir,
    taskName: initialContext.taskName,
    getStage: () => context.currentStage,
    statusPath: initialContext.statusPath,
  });

  // Extract seed for new context structure
  const seed = initialContext.seed || initialContext;

  // Create new context structure with io, llm, meta, data, flags, logs, currentStage
  const context = {
    io: fileIO,
    llm: initialContext.llm,
    meta: {
      taskName: initialContext.taskName,
      workDir: initialContext.workDir,
      statusPath: initialContext.statusPath,
      jobId: initialContext.jobId,
      envLoaded: initialContext.envLoaded,
      modelConfig: initialContext.modelConfig,
      pipelineTasks:
        initialContext.meta?.pipelineTasks ||
        initialContext.pipelineTasks ||
        [],
    },
    data: {
      seed: seed,
    },
    flags: {},
    logs: [],
    currentStage: null,
    validators: {
      validateWithSchema,
    },
  };
  const logs = [];
  let lastStageOutput = context.data.seed;
  let lastStageName = "seed";
  let lastExecutedStageName = "seed";

  // Ensure log directory exists before stage execution
  const logsDir = ensureLogDirectory(context.meta.workDir, context.meta.jobId);

  // Single-pass pipeline execution
  for (const stageConfig of PIPELINE_STAGES) {
    const stageName = stageConfig.name;
    const stageHandler = stageConfig.handler;

    // Skip stages when skipIf predicate returns true
    if (stageConfig.skipIf && stageConfig.skipIf(context.flags)) {
      context.logs.push({
        stage: stageName,
        action: "skipped",
        reason: "skipIf predicate returned true",
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    // Skip if handler is not available (not implemented)
    if (typeof stageHandler !== "function") {
      logs.push({
        stage: stageName,
        skipped: true,
      });
      continue;
    }

    // Add console output capture before stage execution using IO
    const logName = `stage-${stageName}.log`;
    const logPath = path.join(context.meta.workDir, "files", "logs", logName);
    console.debug("[task-runner] stage log path resolution via IO", {
      stage: stageName,
      workDir: context.meta.workDir,
      jobId: context.meta.jobId,
      logName,
      logPath,
    });
    const restoreConsole = captureConsoleOutput(logPath);

    // Set current stage before execution
    context.currentStage = stageName;

    // Write stage start status using writeJobStatus
    if (context.meta.workDir && context.meta.taskName) {
      try {
        await writeJobStatus(context.meta.workDir, (snapshot) => {
          snapshot.current = context.meta.taskName;
          snapshot.currentStage = stageName;
          snapshot.lastUpdated = new Date().toISOString();

          // Ensure task exists and update task-specific fields
          if (!snapshot.tasks[context.meta.taskName]) {
            snapshot.tasks[context.meta.taskName] = {};
          }
          snapshot.tasks[context.meta.taskName].currentStage = stageName;
          snapshot.tasks[context.meta.taskName].state = TaskState.RUNNING;
        });
      } catch (error) {
        // Don't fail the pipeline if status write fails
        console.warn(`Failed to write stage start status: ${error.message}`);
      }
    }

    // Clone data and flags before stage execution
    const stageData = JSON.parse(JSON.stringify(context.data));
    const stageFlags = JSON.parse(JSON.stringify(context.flags));
    const stageContext = {
      io: context.io,
      llm: context.llm,
      meta: context.meta,
      data: stageData,
      flags: stageFlags,
      currentStage: stageName,
      output: JSON.parse(
        JSON.stringify(
          lastStageOutput !== undefined
            ? lastStageOutput
            : (context.data.seed ?? null)
        )
      ),
      previousStage: lastExecutedStageName,
      validators: context.validators,
    };

    // Write pre-execution snapshot for debugging inputs via IO
    const snapshot = {
      meta: { taskName: context.meta.taskName, jobId: context.meta.jobId },
      previousStage: lastExecutedStageName,
      dataSummary: {
        keys: Object.keys(context.data),
        hasSeed: !!context.data?.seed,
        seedKeys: Object.keys(context.data?.seed || {}),
        seedHasData: context.data?.seed?.data !== undefined,
      },
      flagsSummary: {
        keys: Object.keys(context.flags),
      },
      outputSummary: {
        type: typeof stageContext.output,
        keys:
          stageContext.output && typeof stageContext.output === "object"
            ? Object.keys(stageContext.output).slice(0, 20)
            : [],
      },
    };
    await context.io.writeLog(
      `stage-${stageName}-context.json`,
      JSON.stringify(snapshot, null, 2),
      { mode: "replace" }
    );

    // Validate prerequisite flags before stage execution
    const requiredFlags = FLAG_SCHEMAS[stageName]?.requires;
    if (requiredFlags && Object.keys(requiredFlags).length > 0) {
      validateFlagTypes(stageName, context.flags, requiredFlags);
    }

    // Execute the stage
    const start = performance.now();
    let stageResult;
    try {
      context.logs.push({
        stage: stageName,
        action: "debugging",
        data: stageContext,
      });

      console.log("STAGE CONTEXT", JSON.stringify(stageContext, null, 2));
      stageResult = await stageHandler(stageContext);

      // Validate stage result shape after execution
      assertStageResult(stageName, stageResult);

      // Validate produced flags against schema
      const producedFlagsSchema = FLAG_SCHEMAS[stageName]?.produces;
      if (producedFlagsSchema) {
        validateFlagTypes(stageName, stageResult.flags, producedFlagsSchema);
      }

      // Check for flag type conflicts before merging
      checkFlagTypeConflicts(context.flags, stageResult.flags, stageName);

      // Store stage output in context.data
      context.data[stageName] = stageResult.output;

      // Only update lastStageOutput and lastExecutedStageName for non-validation stages
      // This ensures previousStage and context.output skip validation stages
      const validationStages = [
        "validateStructure",
        "validateQuality",
        "validateFinal",
        "finalValidation",
      ];
      if (!validationStages.includes(stageName)) {
        lastStageOutput = stageResult.output;
        lastExecutedStageName = stageName;
      }

      // Merge stage flags into context.flags
      context.flags = { ...context.flags, ...stageResult.flags };

      // Add audit log entry after stage completes
      context.logs.push({
        stage: stageName,
        action: "completed",
        outputType: typeof stageResult.output,
        flagKeys: Object.keys(stageResult.flags),
        timestamp: new Date().toISOString(),
      });

      // Write stage completion status
      if (context.meta.workDir && context.meta.taskName) {
        try {
          await writeJobStatus(context.meta.workDir, (snapshot) => {
            // Keep current task and stage as-is since we're still within the same task
            snapshot.current = context.meta.taskName;
            snapshot.currentStage = stageName;
            snapshot.lastUpdated = new Date().toISOString();

            // Compute deterministic progress after stage completion
            const pct = computeDeterministicProgress(
              context.meta.pipelineTasks || [],
              context.meta.taskName,
              stageName
            );
            snapshot.progress = pct;

            // Debug log for progress computation
            console.debug("[task-runner] stage completion progress", {
              task: context.meta.taskName,
              stage: stageName,
              progress: pct,
            });

            // Ensure task exists and update task-specific fields
            if (!snapshot.tasks[context.meta.taskName]) {
              snapshot.tasks[context.meta.taskName] = {};
            }
            snapshot.tasks[context.meta.taskName].currentStage = stageName;
            snapshot.tasks[context.meta.taskName].state = TaskState.RUNNING;
          });
        } catch (error) {
          // Don't fail the pipeline if status write fails
          console.warn(
            `Failed to write stage completion status: ${error.message}`
          );
        }
      }

      const ms = +(performance.now() - start).toFixed(2);
      logs.push({
        stage: stageName,
        ok: true,
        ms,
      });
    } catch (error) {
      console.error(`Stage ${stageName} failed:`, error);
      const ms = +(performance.now() - start).toFixed(2);
      const errInfo = normalizeError(error);

      // Attach debug metadata to the error envelope for richer diagnostics
      errInfo.debug = {
        stage: stageName,
        previousStage: lastExecutedStageName,
        logPath: path.join(
          context.meta.workDir,
          "files",
          "logs",
          `stage-${stageName}.log`
        ),
        snapshotPath: path.join(logsDir, `stage-${stageName}-context.json`),
        dataHasSeed: !!context.data?.seed,
        seedHasData: context.data?.seed?.data !== undefined,
        flagsKeys: Object.keys(context.flags || {}),
      };

      logs.push({
        stage: stageName,
        ok: false,
        ms,
        error: errInfo,
      });

      // Write failure status using writeJobStatus
      if (context.meta.workDir && context.meta.taskName) {
        try {
          await writeJobStatus(context.meta.workDir, (snapshot) => {
            snapshot.current = context.meta.taskName;
            snapshot.currentStage = stageName;
            snapshot.state = TaskState.FAILED;
            snapshot.lastUpdated = new Date().toISOString();

            // Ensure task exists and update task-specific fields
            if (!snapshot.tasks[context.meta.taskName]) {
              snapshot.tasks[context.meta.taskName] = {};
            }
            snapshot.tasks[context.meta.taskName].state = TaskState.FAILED;
            snapshot.tasks[context.meta.taskName].failedStage = stageName;
            snapshot.tasks[context.meta.taskName].currentStage = stageName;
          });
        } catch (error) {
          // Don't fail the pipeline if status write fails
          console.warn(`Failed to write failure status: ${error.message}`);
        }
      }

      await tokenWriteQueue.catch(() => {});
      llmEvents.off("llm:request:complete", onLLMComplete);

      // Fail immediately on any stage error
      return {
        ok: false,
        failedStage: stageName,
        error: errInfo,
        logs,
        context,
      };
    } finally {
      // Add console output restoration after stage execution
      restoreConsole();
    }
  }

  // Flush any trailing token usage appends before cleanup
  await tokenWriteQueue.catch(() => {}); // absorb last error to not mask pipeline result

  llmEvents.off("llm:request:complete", onLLMComplete);

  // Write final status with currentStage: null to indicate completion
  if (context.meta.workDir && context.meta.taskName) {
    try {
      await writeJobStatus(context.meta.workDir, (snapshot) => {
        snapshot.current = null;
        snapshot.currentStage = null;
        snapshot.state = TaskState.DONE;
        snapshot.progress = 100;
        snapshot.lastUpdated = new Date().toISOString();

        // Update task state to done
        if (!snapshot.tasks[context.meta.taskName]) {
          snapshot.tasks[context.meta.taskName] = {};
        }
        snapshot.tasks[context.meta.taskName].state = TaskState.DONE;
        snapshot.tasks[context.meta.taskName].currentStage = null;
      });
    } catch (error) {
      // Don't fail the pipeline if final status write fails
      console.warn(`Failed to write final status: ${error.message}`);
    }
  }

  return {
    ok: true,
    logs,
    context,
    llmMetrics,
  };
}

export async function runPipelineWithModelRouting(
  modulePath,
  initialContext = {},
  modelConfig = {}
) {
  const context = {
    ...initialContext,
    modelConfig,
    availableModels: modelConfig.models || ["default"],
    currentModel: modelConfig.defaultModel || "default",
  };
  return runPipeline(modulePath, context);
}

function toAbsFileURL(p) {
  if (!path.isAbsolute(p)) {
    throw new Error(
      `Task module path must be absolute. Received: ${p}\n` +
        `Hint: Task paths should be resolved by pipeline-runner.js using the task registry.`
    );
  }
  return pathToFileURL(p);
}

function normalizeError(err) {
  if (err instanceof Error)
    return { name: err.name, message: err.message, stack: err.stack };
  return { message: String(err) };
}

// CLI shim (optional)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modulePath = process.argv[2] || "./tasks/index.js";
  const initJson = process.argv[3];
  const initialContext = initJson ? JSON.parse(initJson) : {};
  runPipeline(modulePath, initialContext)
    .then((result) => {
      const code = result.ok ? 0 : 1;
      console.log(JSON.stringify(result, null, 2));
      process.exit(code);
    })
    .catch((e) => {
      console.error("Runner failed:", e);
      process.exit(1);
    });
}
