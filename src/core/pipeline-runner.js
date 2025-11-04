import fs from "node:fs/promises";
import path from "node:path";
import { runPipeline } from "./task-runner.js";
import { loadFreshModule } from "./module-loader.js";
import { validatePipelineOrThrow } from "./validation.js";
import { getPipelineConfig } from "./config.js";
import { writeJobStatus } from "./status-writer.js";

const ROOT = process.env.PO_ROOT || process.cwd();
const DATA_DIR = path.join(ROOT, process.env.PO_DATA_DIR || "pipeline-data");
const CURRENT_DIR =
  process.env.PO_CURRENT_DIR || path.join(DATA_DIR, "current");
const COMPLETE_DIR =
  process.env.PO_COMPLETE_DIR || path.join(DATA_DIR, "complete");

const jobId = process.argv[2];
if (!jobId) throw new Error("runner requires jobId as argument");

const workDir = path.join(CURRENT_DIR, jobId);

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

for (const taskName of pipeline.tasks) {
  if (status.tasks[taskName]?.state === "done") {
    try {
      const outputPath = path.join(workDir, "tasks", taskName, "output.json");
      const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
      pipelineArtifacts[taskName] = output;
    } catch {}
    continue;
  }

  await updateStatus(taskName, {
    state: "running",
    startedAt: now(),
    attempts: (status.tasks[taskName]?.attempts || 0) + 1,
  });

  const taskDir = path.join(workDir, "tasks", taskName);
  await fs.mkdir(taskDir, { recursive: true });
  await atomicWrite(
    path.join(taskDir, "letter.json"),
    JSON.stringify({ task: taskName, at: now() }, null, 2)
  );

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

    const result = await runPipeline(absoluteModulePath, ctx);

    if (!result.ok) {
      // Persist execution-logs.json and failure-details.json on task failure
      if (result.logs) {
        await atomicWrite(
          path.join(taskDir, "execution-logs.json"),
          JSON.stringify(result.logs, null, 2)
        );
      }
      const failureDetails = {
        failedStage: result.failedStage,
        error: result.error,
        logs: result.logs,
        context: result.context,
        refinementAttempts: result.refinementAttempts || 0,
      };
      await atomicWrite(
        path.join(taskDir, "failure-details.json"),
        JSON.stringify(failureDetails, null, 2)
      );

      // Update tasks-status.json with enriched failure context
      await updateStatus(taskName, {
        state: "failed",
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

    // The file I/O system automatically handles writing outputs and updating tasks-status.json
    // No need to manually write output.json or enumerate artifacts

    if (result.logs) {
      await atomicWrite(
        path.join(taskDir, "execution-logs.json"),
        JSON.stringify(result.logs, null, 2)
      );
    }

    await updateStatus(taskName, {
      state: "done",
      endedAt: now(),
      executionTimeMs:
        result.logs?.reduce((total, log) => total + (log.ms || 0), 0) || 0,
      refinementAttempts: result.refinementAttempts || 0,
    });
  } catch (err) {
    await updateStatus(taskName, {
      state: "failed",
      endedAt: now(),
      error: normalizeError(err),
    });
    process.exitCode = 1;
    process.exit(1);
  }
}

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

async function atomicWrite(file, data) {
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
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
