import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "./task-runner.js";
import { validatePipelineOrThrow } from "./validation.js";

const ROOT = process.env.PO_ROOT || process.cwd();
const DATA_DIR = path.join(ROOT, process.env.PO_DATA_DIR || "pipeline-data");
const CURRENT_DIR =
  process.env.PO_CURRENT_DIR || path.join(DATA_DIR, "current");
const COMPLETE_DIR =
  process.env.PO_COMPLETE_DIR || path.join(DATA_DIR, "complete");

const CONFIG_DIR =
  process.env.PO_CONFIG_DIR || path.join(ROOT, "pipeline-config");
const TASK_REGISTRY =
  process.env.PO_TASK_REGISTRY || path.join(CONFIG_DIR, "tasks/index.js");
const PIPELINE_DEF_PATH =
  process.env.PO_PIPELINE_PATH || path.join(CONFIG_DIR, "pipeline.json");

const jobId = process.argv[2];
if (!jobId) throw new Error("runner requires jobId as argument");

const workDir = path.join(CURRENT_DIR, jobId);
const tasksStatusPath = path.join(workDir, "tasks-status.json");

const pipeline = JSON.parse(await fs.readFile(PIPELINE_DEF_PATH, "utf8"));

// Validate pipeline format early with a friendly error message
validatePipelineOrThrow(pipeline, PIPELINE_DEF_PATH);

// Add cache busting to force task registry reload
const taskRegistryUrl = `${pathToFileURL(TASK_REGISTRY).href}?t=${Date.now()}`;
const tasks = (await import(taskRegistryUrl)).default;

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
      artifacts: pipelineArtifacts,
      taskName,
      taskConfig: pipeline.taskConfig?.[taskName] || {},
    };
    const modulePath = tasks[taskName];
    if (!modulePath) throw new Error(`Task not registered: ${taskName}`);

    // Resolve relative paths from task registry to absolute paths
    const absoluteModulePath = path.isAbsolute(modulePath)
      ? modulePath
      : path.resolve(path.dirname(TASK_REGISTRY), modulePath);

    const result = await runPipeline(absoluteModulePath, ctx);

    if (!result.ok) {
      throw new Error(
        `${taskName} failed after ${result.refinementAttempts || 0} attempts: ${result.error?.message || "unknown"}`
      );
    }

    if (result.context?.output) {
      await atomicWrite(
        path.join(taskDir, "output.json"),
        JSON.stringify(result.context.output, null, 2)
      );
      pipelineArtifacts[taskName] = result.context.output;
    }

    if (result.logs) {
      await atomicWrite(
        path.join(taskDir, "execution-logs.json"),
        JSON.stringify(result.logs, null, 2)
      );
    }

    const artifacts = await getArtifacts(taskDir);
    await updateStatus(taskName, {
      state: "done",
      endedAt: now(),
      artifacts,
      executionTime:
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
    jobId,
    pipelineId: status.pipelineId,
    finishedAt: now(),
    tasks: Object.keys(status.tasks),
    totalExecutionTime: Object.values(status.tasks).reduce(
      (total, t) => total + (t.executionTime || 0),
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
  const current = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
  current.current = taskName;
  current.tasks[taskName] = { ...(current.tasks[taskName] || {}), ...patch };
  await atomicWrite(tasksStatusPath, JSON.stringify(current, null, 2));
  Object.assign(status, current);
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
  if (e instanceof Error)
    return { name: e.name, message: e.message, stack: e.stack };
  return { message: String(e) };
}

async function getArtifacts(dir) {
  const potentialFiles = ["output.json", "letter.json", "execution-logs.json"];
  const artifacts = [];
  for (const file of potentialFiles) {
    try {
      await fs.stat(path.join(dir, file));
      artifacts.push(file);
    } catch {}
  }
  return artifacts;
}
