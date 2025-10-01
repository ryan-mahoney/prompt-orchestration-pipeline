import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLLM, getLLMEvents } from "../llm/index.js";
import { loadEnvironment } from "./environment.js";
import { getConfig } from "./config.js";

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
 * Runs a pipeline by loading a module that exports functions keyed by ORDER.
 */
export async function runPipeline(modulePath, initialContext = {}) {
  if (!initialContext.envLoaded) {
    await loadEnvironment();
    initialContext.envLoaded = true;
  }

  if (!initialContext.llm) {
    initialContext.llm = createLLM({
      defaultProvider: initialContext.modelConfig?.defaultProvider || "openai",
    });
  }

  const config = getConfig();
  const llmMetrics = [];
  const llmEvents = getLLMEvents();

  const onLLMComplete = (metric) => {
    llmMetrics.push({
      ...metric,
      task: context.taskName,
      stage: context.currentStage,
    });
  };

  llmEvents.on("llm:request:complete", onLLMComplete);
  llmEvents.on("llm:request:error", (m) =>
    llmMetrics.push({ ...m, failed: true })
  );

  const abs = toAbsFileURL(modulePath);
  const mod = await import(abs.href);
  const tasks = mod.default ?? mod;

  const context = { ...initialContext, currentStage: null };
  const logs = [];
  let needsRefinement = false;
  let refinementCount = 0;
  const maxRefinements = config.taskRunner.maxRefinementAttempts;

  do {
    needsRefinement = false;
    let preRefinedThisCycle = false;

    for (const stage of ORDER) {
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
        const result = await fn(context);
        if (result && typeof result === "object")
          Object.assign(context, result);

        const ms = +(performance.now() - start).toFixed(2);
        logs.push({ stage, ok: true, ms, refinementCycle: refinementCount });

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
        const errInfo = normalizeError(error);
        logs.push({
          stage,
          ok: false,
          ms,
          error: errInfo,
          refinementCycle: refinementCount,
        });

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
