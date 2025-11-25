import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { runPipeline } from "./task-runner.js";
import { loadFreshModule } from "./module-loader.js";
import { validatePipelineOrThrow } from "./validation.js";
import { getPipelineConfig } from "./config.js";
import { writeJobStatus } from "./status-writer.js";
import { TaskState } from "../config/statuses.js";
import { ensureTaskSymlinkBridge } from "./symlink-bridge.js";
import {
  cleanupTaskSymlinks,
  validateTaskSymlinks,
  repairTaskSymlinks,
} from "./symlink-utils.js";
import { createTaskFileIO, generateLogName } from "./file-io.js";
import { createJobLogger } from "./logger.js";
import { LogEvent, LogFileExtension } from "../config/log-events.js";
import { decideTransition } from "./lifecycle-policy.js";

const ROOT = process.env.PO_ROOT || process.cwd();
const DATA_DIR = path.join(ROOT, process.env.PO_DATA_DIR || "pipeline-data");
const CURRENT_DIR =
  process.env.PO_CURRENT_DIR || path.join(DATA_DIR, "current");
const COMPLETE_DIR =
  process.env.PO_COMPLETE_DIR || path.join(DATA_DIR, "complete");

const jobId = process.argv[2];
if (!jobId) throw new Error("runner requires jobId as argument");

const logger = createJobLogger("PipelineRunner", jobId);

const workDir = path.join(CURRENT_DIR, jobId);

// Write runner PID file for stop functionality
const runnerPidPath = path.join(workDir, "runner.pid");
await fs.writeFile(runnerPidPath, `${process.pid}\n`, "utf8");

// Cleanup function to remove PID file on any exit
async function cleanupRunnerPid() {
  try {
    await fs.unlink(runnerPidPath);
  } catch (error) {
    // ENOENT means file doesn't exist, which is fine
    if (error.code !== "ENOENT") {
      console.error("Failed to cleanup runner PID file:", error);
    }
  }
}

// Register cleanup handlers for all exit scenarios
// Use synchronous unlink for 'exit' handler since it doesn't allow async operations
process.on("exit", () => {
  try {
    fsSync.unlinkSync(runnerPidPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to cleanup runner PID file:", error);
    }
  }
});
process.on("SIGINT", async () => {
  await cleanupRunnerPid();
  process.exit(130);
});
process.on("SIGTERM", async () => {
  await cleanupRunnerPid();
  process.exit(143);
});

const startFromTask = process.env.PO_START_FROM_TASK;
const runSingleTask = process.env.PO_RUN_SINGLE_TASK === "true";

// Get pipeline slug from environment or fallback to seed.json
let pipelineSlug = process.env.PO_PIPELINE_SLUG;
if (!pipelineSlug) {
  try {
    const seedPath = path.join(workDir, "seed.json");
    const seedData = JSON.parse(await fs.readFile(seedPath, "utf8"));
    pipelineSlug = seedData?.pipeline;
    if (!pipelineSlug) {
      throw new Error("No pipeline slug found in seed.json");
    }
  } catch (error) {
    throw new Error(
      `Pipeline slug is required. Set PO_PIPELINE_SLUG environment variable or ensure seed.json contains a 'pipeline' field. Error: ${error.message}`
    );
  }
}

// Use explicit pipeline configuration
const pipelineConfig = getPipelineConfig(pipelineSlug);

const TASK_REGISTRY =
  process.env.PO_TASK_REGISTRY ||
  path.join(pipelineConfig.tasksDir, "index.js");
const PIPELINE_DEF_PATH =
  process.env.PO_PIPELINE_PATH || pipelineConfig.pipelineJsonPath;

const tasksStatusPath = path.join(workDir, "tasks-status.json");

const pipeline = JSON.parse(await fs.readFile(PIPELINE_DEF_PATH, "utf8"));

// Validate pipeline format early with a friendly error message
validatePipelineOrThrow(pipeline, PIPELINE_DEF_PATH);

const tasks = (await loadFreshModule(TASK_REGISTRY)).default;

const status = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
const seed = JSON.parse(
  await fs.readFile(path.join(workDir, "seed.json"), "utf8")
);

let pipelineArtifacts = {};

logger.group("Pipeline execution", {
  jobId,
  pipelineSlug,
  totalTasks: pipeline.tasks.length,
  startFromTask: startFromTask || null,
  runSingleTask,
});

// Helper function to check if all upstream dependencies are completed
function areDependenciesReady(taskName) {
  const taskIndex = pipeline.tasks.indexOf(taskName);
  if (taskIndex === -1) return false;

  const upstreamTasks = pipeline.tasks.slice(0, taskIndex);
  return upstreamTasks.every(
    (upstreamTask) => status.tasks[upstreamTask]?.state === TaskState.DONE
  );
}

try {
  for (const taskName of pipeline.tasks) {
    // Skip tasks before startFromTask when targeting a specific restart point
    if (
      startFromTask &&
      pipeline.tasks.indexOf(taskName) < pipeline.tasks.indexOf(startFromTask)
    ) {
      logger.log("Skipping task before restart point", {
        taskName,
        startFromTask,
      });
      continue;
    }

    if (status.tasks[taskName]?.state === TaskState.DONE) {
      try {
        const outputPath = path.join(workDir, "tasks", taskName, "output.json");
        const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
        pipelineArtifacts[taskName] = output;
        logger.log("Task already completed", { taskName });
      } catch {
        logger.warn("Failed to read completed task output", { taskName });
      }
      continue;
    }

    // Check lifecycle policy before starting task
    const currentTaskState = status.tasks[taskName]?.state || "pending";
    const dependenciesReady = areDependenciesReady(taskName);

    const lifecycleDecision = decideTransition({
      op: "start",
      taskState: currentTaskState,
      dependenciesReady,
    });

    if (!lifecycleDecision.ok) {
      logger.warn("lifecycle_block", {
        jobId,
        taskId: taskName,
        op: "start",
        reason: lifecycleDecision.reason,
      });

      // Create typed error for endpoints to handle
      const lifecycleError = new Error(lifecycleDecision.reason);
      lifecycleError.httpStatus = 409;
      lifecycleError.error = "unsupported_lifecycle";
      lifecycleError.reason = lifecycleDecision.reason;
      throw lifecycleError;
    }

    logger.log("Starting task", { taskName });
    await updateStatus(taskName, {
      state: TaskState.RUNNING,
      startedAt: now(),
      attempts: (status.tasks[taskName]?.attempts || 0) + 1,
    });

    const taskDir = path.join(workDir, "tasks", taskName);
    await fs.mkdir(taskDir, { recursive: true });

    try {
      const ctx = {
        workDir,
        taskDir,
        seed,
        taskName,
        taskConfig: pipeline.taskConfig?.[taskName] || {},
        statusPath: tasksStatusPath,
        jobId,
        meta: {
          pipelineTasks: [...pipeline.tasks],
        },
      };
      const modulePath = tasks[taskName];
      if (!modulePath) throw new Error(`Task not registered: ${taskName}`);

      // Resolve relative paths from task registry to absolute paths
      const absoluteModulePath = path.isAbsolute(modulePath)
        ? modulePath
        : path.resolve(path.dirname(TASK_REGISTRY), modulePath);

      // Validate symlinks before task execution to ensure restart reliability
      const poRoot = process.env.PO_ROOT || process.cwd();
      const expectedTargets = {
        nodeModules: path.join(path.resolve(poRoot, ".."), "node_modules"),
        taskRoot: path.dirname(absoluteModulePath),
      };

      const validationResult = await validateTaskSymlinks(
        taskDir,
        expectedTargets
      );

      if (!validationResult.isValid) {
        logger.warn("Task symlinks validation failed, attempting repair", {
          taskName,
          taskDir,
          errors: validationResult.errors,
          validationDuration: validationResult.duration,
        });

        const repairResult = await repairTaskSymlinks(
          taskDir,
          poRoot,
          absoluteModulePath
        );

        if (!repairResult.success) {
          const errorMessage = `Failed to repair task symlinks for ${taskName}: ${repairResult.errors.join(", ")}`;
          logger.error("Task symlink repair failed, aborting execution", {
            taskName,
            taskDir,
            errors: repairResult.errors,
            repairDuration: repairResult.duration,
          });

          await updateStatus(taskName, {
            state: TaskState.FAILED,
            endedAt: now(),
            error: { message: errorMessage, type: "SymlinkRepairFailed" },
          });

          process.exitCode = 1;
          process.exit(1);
        }

        logger.log("Task symlinks repaired successfully", {
          taskName,
          taskDir,
          repairDuration: repairResult.duration,
          relocatedEntry: repairResult.relocatedEntry,
        });
      } else {
        logger.debug("Task symlinks validation passed", {
          taskName,
          taskDir,
          validationDuration: validationResult.duration,
        });
      }

      // Create symlink bridge for deterministic module resolution
      const relocatedEntry = await ensureTaskSymlinkBridge({
        taskDir,
        poRoot,
        taskModulePath: absoluteModulePath,
      });

      // Create fileIO for this task
      const fileIO = createTaskFileIO({
        workDir,
        taskName,
        getStage: () => null, // pipeline-runner doesn't have stages
        statusPath: tasksStatusPath,
      });

      logger.log("Running task", { taskName, modulePath: absoluteModulePath });
      const result = await runPipeline(relocatedEntry, ctx);

      if (!result.ok) {
        logger.error("Task failed", {
          taskName,
          failedStage: result.failedStage,
          error: result.error,
          refinementAttempts: result.refinementAttempts || 0,
        });

        // Persist execution-logs.json and failure-details.json on task failure via IO
        if (result.logs) {
          await fileIO.writeLog(
            generateLogName(
              taskName,
              "pipeline",
              LogEvent.EXECUTION_LOGS,
              LogFileExtension.JSON
            ),
            JSON.stringify(result.logs, null, 2),
            { mode: "replace" }
          );
        }
        const failureDetails = {
          failedStage: result.failedStage,
          error: result.error,
          logs: result.logs,
          context: result.context,
          refinementAttempts: result.refinementAttempts || 0,
        };
        await fileIO.writeLog(
          generateLogName(
            taskName,
            "pipeline",
            LogEvent.FAILURE_DETAILS,
            LogFileExtension.JSON
          ),
          JSON.stringify(failureDetails, null, 2),
          { mode: "replace" }
        );

        // Update tasks-status.json with enriched failure context
        await updateStatus(taskName, {
          state: TaskState.FAILED,
          endedAt: now(),
          error: result.error, // Don't double-normalize - use result.error as-is
          failedStage: result.failedStage,
          refinementAttempts: result.refinementAttempts || 0,
          stageLogPath: path.join(
            workDir,
            "files",
            "logs",
            `stage-${result.failedStage}.log`
          ),
          errorContext: {
            previousStage: result.context?.previousStage || "seed",
            dataHasSeed: !!result.context?.data?.seed,
            seedHasData: result.context?.data?.seed?.data !== undefined,
            flagsKeys: Object.keys(result.context?.flags || {}),
          },
        });

        // Exit with non-zero status but do not throw to keep consistent flow
        process.exitCode = 1;
        process.exit(1);
      }

      logger.log("Task completed successfully", {
        taskName,
        executionTimeMs:
          result.logs?.reduce((total, log) => total + (log.ms || 0), 0) || 0,
        refinementAttempts: result.refinementAttempts || 0,
      });

      // The file I/O system automatically handles writing outputs and updating tasks-status.json
      // No need to manually write output.json or enumerate artifacts

      if (result.logs) {
        await fileIO.writeLog(
          generateLogName(
            taskName,
            "pipeline",
            LogEvent.EXECUTION_LOGS,
            LogFileExtension.JSON
          ),
          JSON.stringify(result.logs, null, 2),
          { mode: "replace" }
        );
      }

      await updateStatus(taskName, {
        state: TaskState.DONE,
        endedAt: now(),
        executionTimeMs:
          result.logs?.reduce((total, log) => total + (log.ms || 0), 0) || 0,
        refinementAttempts: result.refinementAttempts || 0,
      });

      // Check if this is a single task run and we've completed the target task
      if (runSingleTask && taskName === startFromTask) {
        logger.log("Stopping after single task execution", { taskName });
        break;
      }
    } catch (err) {
      await updateStatus(taskName, {
        state: TaskState.FAILED,
        endedAt: now(),
        error: normalizeError(err),
      });
      process.exitCode = 1;
      process.exit(1);
    }
  }

  // Only move to complete if this wasn't a single task run
  if (!runSingleTask) {
    await fs.mkdir(COMPLETE_DIR, { recursive: true });
    const dest = path.join(COMPLETE_DIR, jobId);

    logger.log("Pipeline completed", {
      jobId,
      totalExecutionTime: Object.values(status.tasks).reduce(
        (total, t) => total + (t.executionTimeMs || 0),
        0
      ),
      totalRefinementAttempts: Object.values(status.tasks).reduce(
        (total, t) => total + (t.refinementAttempts || 0),
        0
      ),
      finalArtifacts: Object.keys(pipelineArtifacts),
    });

    await fs.rename(workDir, dest);
    await appendLine(
      path.join(COMPLETE_DIR, "runs.jsonl"),
      JSON.stringify({
        id: status.id,
        finishedAt: now(),
        tasks: Object.keys(status.tasks),
        totalExecutionTime: Object.values(status.tasks).reduce(
          (total, t) => total + (t.executionTimeMs || 0),
          0
        ),
        totalRefinementAttempts: Object.values(status.tasks).reduce(
          (total, t) => total + (t.refinementAttempts || 0),
          0
        ),
        finalArtifacts: Object.keys(pipelineArtifacts),
      }) + "\n"
    );

    // Clean up task symlinks to avoid dangling links in archives
    await cleanupTaskSymlinks(dest);
  } else {
    logger.log("Single task run completed, job remains in current", { jobId });
  }
} catch (error) {
  throw error;
} finally {
  // Always ensure PID cleanup at the end of execution
  await cleanupRunnerPid();
}

logger.groupEnd();

function now() {
  return new Date().toISOString();
}

async function updateStatus(taskName, patch) {
  return await writeJobStatus(workDir, (snapshot) => {
    snapshot.current = taskName;
    snapshot.tasks = snapshot.tasks || {};
    snapshot.tasks[taskName] = {
      ...(snapshot.tasks[taskName] || {}),
      ...patch,
    };
    return snapshot;
  }).then((snap) => {
    Object.assign(status, snap);
    return snap;
  });
}

async function appendLine(file, line) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, line);
}

function normalizeError(e) {
  // If it's already a structured error object with a message string, pass it through
  if (e && typeof e === "object" && typeof e.message === "string") {
    return e;
  }

  if (e instanceof Error)
    return { name: e.name, message: e.message, stack: e.stack };
  return { message: String(e) };
}
