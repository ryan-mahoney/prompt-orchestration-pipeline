import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs";
import { createLLM, getLLMEvents } from "../llm/index.js";
import { loadEnvironment } from "./environment.js";
import { getConfig } from "./config.js";
import { createTaskFileIO } from "./file-io.js";

/** Canonical order using the field terms we discussed */
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
  const logsPath = path.join(workDir, jobId, "files", "logs");
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

  // Override console methods to write to stream
  console.log = (...args) => logStream.write(args.join(" ") + "\n");
  console.error = (...args) =>
    logStream.write("[ERROR] " + args.join(" ") + "\n");
  console.warn = (...args) =>
    logStream.write("[WARN] " + args.join(" ") + "\n");
  console.info = (...args) =>
    logStream.write("[INFO] " + args.join(" ") + "\n");

  // Return restoration function
  return () => {
    logStream.end();
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
  };
}

/**
 * Flag schemas for each pipeline stage.
 * Defines required flags (prerequisites) and produced flags (outputs) with their types.
 */
const FLAG_SCHEMAS = {
  validateStructure: {
    requires: {},
    produces: {
      validationFailed: "boolean",
      lastValidationError: ["string", "object", "undefined"],
    },
  },
  critique: {
    requires: {},
    produces: {
      critiqueComplete: "boolean",
    },
  },
  refine: {
    requires: {
      validationFailed: "boolean",
    },
    produces: {
      refined: "boolean",
    },
  },
};

/**
 * Hard-coded pipeline stage execution order and configuration.
 * Each stage defines its handler, skip predicate, and iteration limits.
 */
const PIPELINE_STAGES = [
  {
    name: "validateStructure",
    handler: null, // Will be populated from dynamic module import
    skipIf: null,
    maxIterations: null,
  },
  {
    name: "critique",
    handler: null, // Will be populated from dynamic module import
    skipIf: (flags) => flags.validationFailed === false,
    maxIterations: null,
  },
  {
    name: "refine",
    handler: null, // Will be populated from dynamic module import
    skipIf: (flags) => flags.validationFailed === false,
    maxIterations: (seed) => seed.maxRefinements || 1,
  },
];

/**
 * Runs a pipeline by loading a module that exports functions keyed by ORDER.
 */
export async function runPipeline(modulePath, initialContext = {}) {
  if (!initialContext.envLoaded) {
    await loadEnvironment();
    initialContext.envLoaded = true;
  }

  if (!initialContext.llm) {
    initialContext.llm = createLLM({
      defaultProvider:
        initialContext.modelConfig?.defaultProvider ||
        process.env.PO_DEFAULT_PROVIDER ||
        "openai",
    });
  }

  const config = getConfig();
  const llmMetrics = [];
  const llmEvents = getLLMEvents();

  const onLLMComplete = (metric) => {
    llmMetrics.push({
      ...metric,
      task: context.meta.taskName,
      stage: context.currentStage,
    });
  };

  llmEvents.on("llm:request:complete", onLLMComplete);
  llmEvents.on("llm:request:error", (m) =>
    llmMetrics.push({ ...m, failed: true })
  );

  const abs = toAbsFileURL(modulePath);
  // Add cache busting to force module reload
  const modUrl = `${abs.href}?t=${Date.now()}`;
  const mod = await import(modUrl);
  const tasks = mod.default ?? mod;

  // Populate PIPELINE_STAGES handlers from dynamically loaded tasks
  PIPELINE_STAGES.forEach((stageConfig) => {
    if (
      tasks[stageConfig.name] &&
      typeof tasks[stageConfig.name] === "function"
    ) {
      stageConfig.handler = tasks[stageConfig.name];
    } else {
      // Create placeholder handler that throws "Not implemented" error
      stageConfig.handler = async function (context) {
        throw new Error(
          `Stage "${stageConfig.name}" is not implemented in the loaded module`
        );
      };
    }
  });

  // Create fileIO singleton if we have the required context
  let fileIO = null;
  if (
    initialContext.workDir &&
    initialContext.taskName &&
    initialContext.statusPath
  ) {
    fileIO = createTaskFileIO({
      workDir: initialContext.workDir,
      taskName: initialContext.taskName,
      getStage: () => context.currentStage,
      statusPath: initialContext.statusPath,
    });
  }

  // Extract seed and maxRefinements for new context structure
  const seed = initialContext.seed || initialContext;
  const maxRefinements = seed.maxRefinements || 1;

  // Create new context structure with meta, data, flags, logs, currentStage
  const context = {
    meta: {
      taskName: initialContext.taskName,
      workDir: initialContext.workDir,
      statusPath: initialContext.statusPath,
      jobId: initialContext.jobId,
      llm: initialContext.llm,
      io: fileIO,
      envLoaded: initialContext.envLoaded,
      modelConfig: initialContext.modelConfig,
    },
    data: {
      seed: seed,
    },
    flags: {},
    logs: [],
    currentStage: null,
  };
  const logs = [];
  let needsRefinement = false;
  let refinementCount = 0;

  // Ensure log directory exists before stage execution
  ensureLogDirectory(context.meta.workDir, context.meta.jobId);

  do {
    needsRefinement = false;
    let preRefinedThisCycle = false;

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
          refinementCycle: refinementCount,
        });
        continue;
      }

      // Skip ingestion and preProcessing during refinement cycles
      if (
        refinementCount > 0 &&
        ["ingestion", "preProcessing"].includes(stageName)
      ) {
        logs.push({
          stage: stageName,
          skipped: true,
          reason: "refinement-cycle",
          refinementCycle: refinementCount,
        });
        continue;
      }

      // Handle pre-refinement logic for validation stages
      if (
        refinementCount > 0 &&
        !preRefinedThisCycle &&
        !context.flags.refined &&
        (stageName === "validateStructure" || stageName === "validateQuality")
      ) {
        for (const s of ["critique", "refine"]) {
          const sConfig = PIPELINE_STAGES.find((config) => config.name === s);
          const sHandler = sConfig?.handler;
          if (typeof sHandler !== "function") {
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
            const r = await sHandler(context);
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
            const errInfo = normalizeError(error);
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

      // Skip critique and refine if already pre-refined
      if (
        preRefinedThisCycle &&
        (stageName === "critique" || stageName === "refine")
      ) {
        logs.push({
          stage: stageName,
          skipped: true,
          reason: "already-pre-refined",
          refinementCycle: refinementCount,
        });
        continue;
      }

      // Add console output capture before stage execution
      const logPath = path.join(
        context.meta.workDir,
        context.meta.jobId,
        "files",
        "logs",
        `stage-${stageName}.log`
      );
      const restoreConsole = captureConsoleOutput(logPath);

      // Clone data and flags before stage execution
      const stageData = structuredClone(context.data);
      const stageFlags = structuredClone(context.flags);
      const stageContext = {
        ...context.meta,
        data: stageData,
        flags: stageFlags,
        currentStage: stageName,
      };

      // Validate prerequisite flags before stage execution
      const requiredFlags = FLAG_SCHEMAS[stageName]?.requires;
      if (requiredFlags && Object.keys(requiredFlags).length > 0) {
        validateFlagTypes(stageName, context.flags, requiredFlags);
      }

      // Execute the stage
      const start = performance.now();
      let stageResult;
      try {
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

        // Persist context.data and context.flags to tasks-status.json
        if (context.meta.statusPath) {
          const statusData = {
            data: context.data,
            flags: context.flags,
            logs: context.logs,
            currentStage: context.currentStage,
            refinementCount,
            lastUpdated: new Date().toISOString(),
          };
          fs.writeFileSync(
            context.meta.statusPath,
            JSON.stringify(statusData, null, 2)
          );
        }

        const ms = +(performance.now() - start).toFixed(2);
        logs.push({
          stage: stageName,
          ok: true,
          ms,
          refinementCycle: refinementCount,
        });

        if (
          (stageName === "validateStructure" ||
            stageName === "validateQuality") &&
          context.flags.validationFailed &&
          refinementCount < maxRefinements
        ) {
          needsRefinement = true;
          context.flags.validationFailed = false;
          break;
        }
      } catch (error) {
        const ms = +(performance.now() - start).toFixed(2);
        const errInfo = normalizeError(error);
        logs.push({
          stage: stageName,
          ok: false,
          ms,
          error: errInfo,
          refinementCycle: refinementCount,
        });

        if (
          (stageName === "validateStructure" ||
            stageName === "validateQuality") &&
          refinementCount < maxRefinements
        ) {
          context.flags.lastValidationError = errInfo;
          needsRefinement = true;
          break;
        }

        return {
          ok: false,
          failedStage: stageName,
          error: errInfo,
          logs,
          context,
          refinementAttempts: refinementCount,
        };
      } finally {
        // Add console output restoration after stage execution
        if (restoreConsole) {
          restoreConsole();
        }
      }
    }

    // Handle stages not in PIPELINE_STAGES (legacy stages from ORDER)
    for (const stage of ORDER) {
      // Skip if stage is already handled by PIPELINE_STAGES
      if (PIPELINE_STAGES.some((config) => config.name === stage)) {
        continue;
      }

      context.currentStage = stage;
      const fn = tasks[stage];
      if (typeof fn !== "function") {
        logs.push({ stage, skipped: true, refinementCycle: refinementCount });
        continue;
      }

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

      const start = performance.now();
      try {
        const result = await fn(context);
        if (result && typeof result === "object")
          Object.assign(context, result);

        const ms = +(performance.now() - start).toFixed(2);
        logs.push({ stage, ok: true, ms, refinementCycle: refinementCount });
      } catch (error) {
        const ms = +(performance.now() - start).toFixed(2);
        const errInfo = normalizeError(error);
        logs.push({
          stage,
          ok: false,
          ms,
          error: errInfo,
          refinementCycle: refinementCount,
        });

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

  // Only fail on validationFailed if we actually have validation functions
  const hasValidation =
    typeof tasks.validateStructure === "function" ||
    typeof tasks.validateQuality === "function";

  if (context.flags.validationFailed && hasValidation) {
    return {
      ok: false,
      failedStage: "final-validation",
      error: { message: "Validation failed after all refinement attempts" },
      logs,
      context,
      refinementAttempts: refinementCount,
    };
  }

  llmEvents.off("llm:request:complete", onLLMComplete);

  return {
    ok: true,
    logs,
    context,
    refinementAttempts: refinementCount,
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
