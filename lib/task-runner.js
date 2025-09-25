// task-runner.js (ESM)
// Usage: node task-runner.js ./tasks/index.js

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Canonical order using the field terms we discussed */
const ORDER = [
  "ingestion", // Data Retrieval / Context Assembly
  "preProcessing", // Data Compression / Pre-processing
  "promptTemplating", // Prompt Construction
  "inference", // Prompt Execution
  "parsing", // Structural Parsing / Normalization
  "validateStructure", // Structural Validation (schema/regex/etc.)
  "validateQuality", // Semantic/Quality Validation
  "critique", // Hint Generation / Critique
  "refine", // Re-prompt / Re-transform
  "finalValidation", // Re-validation (structural + semantic)
  "integration", // Output packaging / write-out
];

/**
 * Runs a pipeline by loading a module that exports functions keyed by the
 * names in ORDER. Any missing sub-task is skipped.
 * Each function receives and may mutate `context`.
 */
export async function runPipeline(modulePath, initialContext = {}) {
  const abs = toAbsFileURL(modulePath);
  const mod = await import(abs.href);
  const tasks = mod.default ?? mod; // allow default or named export object

  const context = { ...initialContext };
  const logs = [];
  let needsRefinement = false;
  let refinementCount = 0;
  const maxRefinements = 2;

  // Main execution loop with refinement support
  do {
    needsRefinement = false;
    let preRefinedThisCycle = false;

    for (const stage of ORDER) {
      const fn = tasks[stage];
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
          const f = tasks[s];
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
      if (preRefinedThisCycle && (stage === "critique" || stage === "refine")) {
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
        // Each task can mutate and/or return a partial update to context
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
          context.validationFailed = false; // Reset for next cycle
          break; // Exit current cycle to start refinement
        }
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
}

/**
 * Enhanced pipeline runner with model routing support
 */
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

/**
 * Utility function to select appropriate model based on task characteristics
 */
export function selectModel(taskType, complexity, speed = "normal") {
  const modelMap = {
    "simple-fast": "gpt-3.5-turbo",
    "simple-accurate": "gpt-4",
    "complex-fast": "gpt-4",
    "complex-accurate": "gpt-4-turbo",
    specialized: "claude-3-opus",
  };

  const key =
    complexity === "high"
      ? speed === "fast"
        ? "complex-fast"
        : "complex-accurate"
      : speed === "fast"
        ? "simple-fast"
        : "simple-accurate";

  return modelMap[key] || "gpt-4";
}

function toAbsFileURL(p) {
  const cwd = process.cwd();
  const absPath = path.isAbsolute(p) ? p : path.join(cwd, "pipeline-tasks", p);

  return pathToFileURL(absPath);
}

function normalizeError(err) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

// Allow simple CLI usage
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modulePath = process.argv[2] || "./tasks/index.js";
  const initJson = process.argv[3]; // optional initial context as JSON
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
