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

const getTaskName = (t) => (typeof t === "string" ? t : t.name);

function now() {
  return new Date().toISOString();
}

async function appendLine(file, line) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, line);
}

function normalizeError(e) {
  if (e && typeof e === "object" && typeof e.message === "string") return e;
  if (e instanceof Error)
    return { name: e.name, message: e.message, stack: e.stack };
  return { message: String(e) };
}

/**
 * Run a pipeline job. Reads configuration from environment variables:
 * PO_ROOT, PO_DATA_DIR, PO_CURRENT_DIR, PO_COMPLETE_DIR,
 * PO_START_FROM_TASK, PO_RUN_SINGLE_TASK, PO_PIPELINE_SLUG,
 * PO_TASK_REGISTRY, PO_PIPELINE_PATH
 *
 * @param {string} jobId - The job identifier
 */
export async function runPipelineJob(jobId) {
  const ROOT = process.env.PO_ROOT || process.cwd();
  const DATA_DIR = path.join(ROOT, process.env.PO_DATA_DIR || "pipeline-data");
  const CURRENT_DIR =
    process.env.PO_CURRENT_DIR || path.join(DATA_DIR, "current");
  const COMPLETE_DIR =
    process.env.PO_COMPLETE_DIR || path.join(DATA_DIR, "complete");

  const logger = createJobLogger("PipelineRunner", jobId);
  const workDir = path.join(CURRENT_DIR, jobId);

  // Write runner PID file for stop functionality
  const runnerPidPath = path.join(workDir, "runner.pid");
  await fs.writeFile(runnerPidPath, `${process.pid}\n`, "utf8");

  async function cleanupRunnerPid() {
    try {
      await fs.unlink(runnerPidPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Failed to cleanup runner PID file:", error);
      }
    }
  }

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

  const pipelineConfig = getPipelineConfig(pipelineSlug);

  const TASK_REGISTRY =
    process.env.PO_TASK_REGISTRY ||
    path.join(pipelineConfig.tasksDir, "index.js");
  const PIPELINE_DEF_PATH =
    process.env.PO_PIPELINE_PATH || pipelineConfig.pipelineJsonPath;

  const tasksStatusPath = path.join(workDir, "tasks-status.json");

  const pipeline = JSON.parse(await fs.readFile(PIPELINE_DEF_PATH, "utf8"));
  validatePipelineOrThrow(pipeline, PIPELINE_DEF_PATH);

  const llmOverride = pipeline.llm || null;
  const taskNames = pipeline.tasks.map(getTaskName);
  const tasks = (await loadFreshModule(TASK_REGISTRY)).default;

  const status = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
  const seed = JSON.parse(
    await fs.readFile(path.join(workDir, "seed.json"), "utf8")
  );

  let pipelineArtifacts = {};

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

  function areDependenciesReady(taskName) {
    const taskIndex = taskNames.indexOf(taskName);
    if (taskIndex === -1) return false;
    const upstreamTasks = taskNames.slice(0, taskIndex);
    return upstreamTasks.every(
      (upstreamTask) => status.tasks[upstreamTask]?.state === TaskState.DONE
    );
  }

  logger.group("Pipeline execution", {
    jobId,
    pipelineSlug,
    totalTasks: pipeline.tasks.length,
    startFromTask: startFromTask || null,
    runSingleTask,
  });

  try {
    for (const taskName of taskNames) {
      if (
        startFromTask &&
        taskNames.indexOf(taskName) < taskNames.indexOf(startFromTask)
      ) {
        continue;
      }

      if (status.tasks[taskName]?.state === TaskState.DONE) {
        try {
          const outputPath = path.join(workDir, "tasks", taskName, "output.json");
          const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
          pipelineArtifacts[taskName] = output;
        } catch {
          logger.warn("Failed to read completed task output", { taskName });
        }
        continue;
      }

      if (!startFromTask) {
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

          const lifecycleError = new Error(lifecycleDecision.reason);
          lifecycleError.httpStatus = 409;
          lifecycleError.error = "unsupported_lifecycle";
          lifecycleError.reason = lifecycleDecision.reason;
          throw lifecycleError;
        }
      }

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
          llmOverride,
          meta: {
            pipelineTasks: [...pipeline.tasks],
          },
        };
        const modulePath = tasks[taskName];
        if (!modulePath) throw new Error(`Task not registered: ${taskName}`);

        const absoluteModulePath = path.isAbsolute(modulePath)
          ? modulePath
          : path.resolve(path.dirname(TASK_REGISTRY), modulePath);

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
        } else {
          logger.debug("Task symlinks validation passed", {
            taskName,
            taskDir,
            validationDuration: validationResult.duration,
          });
        }

        const relocatedEntry = await ensureTaskSymlinkBridge({
          taskDir,
          poRoot,
          taskModulePath: absoluteModulePath,
        });

        const fileIO = createTaskFileIO({
          workDir,
          taskName,
          getStage: () => null,
          statusPath: tasksStatusPath,
        });

        const result = await runPipeline(relocatedEntry, ctx);

        if (!result.ok) {
          logger.error("Task failed", {
            taskName,
            failedStage: result.failedStage,
            error: result.error,
            refinementAttempts: result.refinementAttempts || 0,
          });

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

          await updateStatus(taskName, {
            state: TaskState.FAILED,
            endedAt: now(),
            error: result.error,
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

          process.exitCode = 1;
          process.exit(1);
        }

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

        if (runSingleTask && taskName === startFromTask) {
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

    if (!runSingleTask) {
      await fs.mkdir(COMPLETE_DIR, { recursive: true });
      const dest = path.join(COMPLETE_DIR, jobId);

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

      await cleanupTaskSymlinks(dest);
    }
  } catch (error) {
    logger.error("Pipeline execution failed with unhandled error", {
      jobId,
      pipelineSlug,
      error: normalizeError(error),
    });

    console.error("[PipelineRunner] Fatal error:", error);
    process.exitCode = 1;

    const forceExitTimeout = setTimeout(() => {
      console.error("[PipelineRunner] Force exit timeout reached, terminating process");
      process.exit(1);
    }, 5000);
    forceExitTimeout.unref();

    await cleanupRunnerPid();
    process.exit(1);
  } finally {
    await cleanupRunnerPid();
  }

  logger.groupEnd();
}

// Direct execution: thin wrapper for source-mode only (compiled binary uses _run-job subcommand)
if (
  process.argv[1] &&
  process.argv[1] !== process.execPath &&
  (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/pipeline-runner.js"))
) {
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[PipelineRunner] Unhandled promise rejection:", reason);
    console.error("[PipelineRunner] Promise:", promise);
    setTimeout(() => {
      console.error("[PipelineRunner] Forcing exit due to unhandled rejection");
      process.exit(1);
    }, 100);
  });

  process.on("uncaughtException", (error) => {
    console.error("[PipelineRunner] Uncaught exception:", error);
    setTimeout(() => {
      console.error("[PipelineRunner] Forcing exit due to uncaught exception");
      process.exit(1);
    }, 100);
  });

  const jobId = process.argv[2];
  if (!jobId) {
    console.error("runner requires jobId as argument");
    process.exit(1);
  }

  runPipelineJob(jobId);
}
