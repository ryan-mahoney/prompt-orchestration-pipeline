import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "./task-runner.js";

const ROOT = process.cwd();
const CURRENT_DIR = path.join(ROOT, "pipeline-current");
const COMPLETE_DIR = path.join(ROOT, "pipeline-complete");
const TASK_REGISTRY = path.join(ROOT, "pipeline-tasks/index.js");
const PIPELINE_DEF = path.join(ROOT, "pipeline.json");

const name = process.argv[2];
if (!name) throw new Error("runner requires pipeline name");

const workDir = path.join(CURRENT_DIR, name);
const tasksStatusPath = path.join(workDir, "tasks-status.json");

const pipeline = JSON.parse(await fs.readFile(PIPELINE_DEF, "utf8"));
const tasks = (await import(pathToFileURL(TASK_REGISTRY))).default;

const status = JSON.parse(await fs.readFile(tasksStatusPath, "utf8"));
const seed = JSON.parse(
  await fs.readFile(path.join(workDir, "seed.json"), "utf8")
);

// Initialize artifacts store for passing between tasks
let pipelineArtifacts = {};

for (const taskName of pipeline.tasks) {
  // Skip if already done (idempotent resume)
  if (status.tasks[taskName]?.state === "done") {
    // Load existing artifacts for downstream tasks
    try {
      const outputPath = path.join(workDir, "tasks", taskName, "output.json");
      const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
      pipelineArtifacts[taskName] = output;
    } catch (err) {
      // Continue if artifacts can't be loaded
    }
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
    };

    const modulePath = tasks[taskName];
    if (!modulePath) throw new Error(`Task not registered: ${taskName}`);

    // Run the inner pipeline (task-runner handles retries internally)
    const result = await runPipeline(modulePath, ctx);

    if (!result.ok) {
      throw new Error(
        `${taskName} failed after ${result.refinementAttempts || 0} attempts: ${
          result.error?.message || "unknown"
        }`
      );
    }

    // Persist primary artifact if provided
    if (result.context?.output) {
      await atomicWrite(
        path.join(taskDir, "output.json"),
        JSON.stringify(result.context.output, null, 2)
      );

      // Store artifact for next tasks
      pipelineArtifacts[taskName] = result.context.output;
    }

    // Save execution logs
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
      artifacts: artifacts,
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
    process.exit(1); // leave working dir for inspection
  }
}

// Promote to complete (atomic dir rename)
await fs.mkdir(COMPLETE_DIR, { recursive: true });
const dest = path.join(COMPLETE_DIR, name);
await fs.rename(workDir, dest);
await appendLine(
  path.join(COMPLETE_DIR, "runs.jsonl"),
  JSON.stringify({
    name,
    pipelineId: status.pipelineId,
    finishedAt: now(),
    tasks: Object.keys(status.tasks),
    totalExecutionTime: Object.values(status.tasks).reduce(
      (total, task) => total + (task.executionTime || 0),
      0
    ),
    totalRefinementAttempts: Object.values(status.tasks).reduce(
      (total, task) => total + (task.refinementAttempts || 0),
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
  Object.assign(status, current); // local copy for loop decisions
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
    } catch {
      // File doesn't exist, skip
    }
  }

  return artifacts;
}
