#!/usr/bin/env bun
import { Command } from "commander";
import { mkdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";

import { STAGE_NAMES, getStagePurpose, KEBAB_CASE_REGEX } from "./constants.ts";
import { buildReexecArgs, isCompiledBinary } from "./self-reexec.ts";
import { updatePipelineJson } from "./update-pipeline-json.ts";
import { analyzeTaskFile } from "./analyze-task.ts";
import { submitJobWithValidation, PipelineOrchestrator } from "../api/index.ts";
import type { Registry } from "./types.ts";

// ─── init ─────────────────────────────────────────────────────────────────────

export async function handleInit(root: string): Promise<void> {
  const dataDirs = ["pending", "current", "complete", "rejected"];

  await mkdir(join(root, "pipeline-config"), { recursive: true });
  for (const sub of dataDirs) {
    await mkdir(join(root, "pipeline-data", sub), { recursive: true });
    await Bun.write(join(root, "pipeline-data", sub, ".gitkeep"), "");
  }
  await Bun.write(
    join(root, "registry.json"),
    JSON.stringify({ pipelines: {} }, null, 2) + "\n"
  );
}

// ─── start ────────────────────────────────────────────────────────────────────

export async function handleStart(
  root: string | undefined,
  port: string
): Promise<void> {
  const rawRoot = root ?? process.env["PO_ROOT"];
  if (!rawRoot) {
    console.error("Error: --root or PO_ROOT environment variable is required");
    process.exit(1);
  }

  const absoluteRoot = resolve(rawRoot);
  process.env["PO_ROOT"] = absoluteRoot;

  if (!isCompiledBinary()) {
    const distPath = join(import.meta.dir, "../../ui/dist");
    try {
      await access(distPath);
    } catch {
      console.error(
        `Error: src/ui/dist not found at ${distPath}. Run 'bun run ui:build' first.`
      );
      process.exit(1);
    }
  }

  const uiEnv: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, NODE_ENV: "production", PO_ROOT: absoluteRoot, PORT: port }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  delete uiEnv["PO_UI_PORT"];

  const orchEnv: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, NODE_ENV: "production", PO_ROOT: absoluteRoot }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );

  const uiReexec = buildReexecArgs(["_start-ui"]);
  const orchReexec = buildReexecArgs(["_start-orchestrator"]);

  let uiChild: Bun.ReadableSubprocess | null = null;
  let orchChild: Bun.ReadableSubprocess | null = null;

  async function killChild(
    child: Bun.ReadableSubprocess | null
  ): Promise<void> {
    if (!child) return;
    try {
      child.kill(15); // SIGTERM
      const graceful = await Promise.race([
        child.exited.then(() => true),
        new Promise<false>((res) => setTimeout(() => res(false), 5000)),
      ]);
      if (!graceful) child.kill(9); // SIGKILL
    } catch {
      // ignore
    }
  }

  async function cleanup(): Promise<void> {
    await Promise.all([killChild(uiChild), killChild(orchChild)]);
  }

  async function pipeOutput(
    stream: ReadableStream<Uint8Array> | null,
    prefix: string,
    dest: { write: (chunk: string) => boolean | void }
  ): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        dest.write(`${prefix} ${line}\n`);
      }
    }
    if (buffer) dest.write(`${prefix} ${buffer}\n`);
  }

  try {
    uiChild = Bun.spawn([uiReexec.execPath, ...uiReexec.args], {
      env: uiEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    orchChild = Bun.spawn([orchReexec.execPath, ...orchReexec.args], {
      env: orchEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    process.on("SIGINT", () => {
      void cleanup().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      void cleanup().then(() => process.exit(0));
    });

    void pipeOutput(uiChild.stdout, "[ui]", process.stdout);
    void pipeOutput(uiChild.stderr, "[ui]", process.stderr);
    void pipeOutput(orchChild.stdout, "[orc]", process.stdout);
    void pipeOutput(orchChild.stderr, "[orc]", process.stderr);

    const uiExited = uiChild.exited;
    const orchExited = orchChild.exited;

    const result = await Promise.race([
      uiExited.then((code) => ({ which: "ui" as const, code })),
      orchExited.then((code) => ({ which: "orc" as const, code })),
    ]);

    const exitCode = result.code ?? 1;
    if (exitCode !== 0) {
      await cleanup();
      process.exit(exitCode);
    }
  } catch (err) {
    console.error("Error starting processes:", err);
    await cleanup();
    process.exit(1);
  }
}

// ─── submit ───────────────────────────────────────────────────────────────────

export async function handleSubmit(seedFile: string): Promise<void> {
  let seedObject: unknown;
  try {
    const text = await Bun.file(seedFile).text();
    seedObject = JSON.parse(text) as unknown;
  } catch (err) {
    console.error(`Error reading or parsing seed file: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    const result = await submitJobWithValidation({ dataDir: process.cwd(), seedObject });
    if (result.success) {
      console.log(`Job submitted: ${result.jobId} (${result.jobName})`);
    } else {
      console.error(`Job submission failed: ${result.message}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error submitting job: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── status ───────────────────────────────────────────────────────────────────

export async function handleStatus(jobName: string | undefined): Promise<void> {
  const orchestrator = new PipelineOrchestrator({ autoStart: false });
  if (jobName) {
    const result = await orchestrator.getStatus(jobName);
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = await orchestrator.listJobs();
    console.table(result);
  }
}

// ─── add-pipeline ─────────────────────────────────────────────────────────────

export async function handleAddPipeline(slug: string, root: string): Promise<void> {
  if (!KEBAB_CASE_REGEX.test(slug)) {
    console.error(`Error: Invalid pipeline slug "${slug}". Must match /^[a-z0-9-]+$/`);
    process.exit(1);
    return;
  }

  try {
    const pipelineDir = join(root, "pipeline-config", slug);
    const tasksDir = join(pipelineDir, "tasks");
    await mkdir(tasksDir, { recursive: true });

    const pipelineConfig = {
      name: slug,
      version: "1.0.0",
      description: "New pipeline",
      tasks: [] as string[],
    };
    await Bun.write(
      join(pipelineDir, "pipeline.json"),
      JSON.stringify(pipelineConfig, null, 2) + "\n"
    );
    await Bun.write(join(tasksDir, "index.ts"), "export default {};\n");

    const registryPath = join(root, "registry.json");
    let registry: Registry = { pipelines: {} };
    try {
      const text = await Bun.file(registryPath).text();
      registry = JSON.parse(text) as Registry;
    } catch {
      // fallback to empty registry
    }

    const pipelinePath = join(pipelineDir, "pipeline.json");
    const taskRegistryPath = join(tasksDir, "index.ts");
    registry.pipelines[slug] = {
      name: slug,
      description: "New pipeline",
      pipelinePath,
      taskRegistryPath,
    };

    await Bun.write(registryPath, JSON.stringify(registry, null, 2) + "\n");
  } catch (err) {
    console.error(`Error creating pipeline: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── add-pipeline-task ────────────────────────────────────────────────────────

function generateTaskFileContent(taskSlug: string): string {
  const lines: string[] = [];

  for (const stage of STAGE_NAMES) {
    const purpose = getStagePurpose(stage);
    lines.push(`// ${stage}: ${purpose}`);

    if (stage === "ingestion") {
      lines.push(`export async function ${stage}({ data: { seed } }: { data: { seed: unknown } }) {`);
    } else {
      lines.push(`export async function ${stage}({ data }: { data: unknown }) {`);
    }
    lines.push(`  void ${stage === "ingestion" ? "seed" : "data"};`);
    lines.push(`  return { output: {}, flags: {} };`);
    lines.push(`}`);
    lines.push(``);
  }

  void taskSlug;
  return lines.join("\n");
}

function parseTaskIndex(content: string): Map<string, string> | null {
  const outerMatch = /^export default \{([\s\S]*)\};\s*$/.exec(content.trim());
  if (!outerMatch) return null;

  const body = outerMatch[1] ?? "";
  const entries = new Map<string, string>();
  const entryRegex = /\s*"([^"]+)"\s*:\s*"([^"]+)"\s*/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(body)) !== null) {
    entries.set(match[1]!, match[2]!);
  }

  // Validate: strip all matched entries and commas from body; only whitespace should remain.
  // This rejects single-quoted keys, unquoted keys, inline comments, etc.
  const stripped = body
    .replace(/\s*"[^"]+"\s*:\s*"[^"]+"\s*/g, "")
    .replace(/,/g, "")
    .trim();
  if (stripped.length > 0) return null;

  return entries;
}

function serializeTaskIndex(entries: Map<string, string>): string {
  const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (sorted.length === 0) return `export default {\n};\n`;
  const body = sorted.map(([k, v]) => `  "${k}": "${v}",`).join("\n");
  return `export default {\n${body}\n};\n`;
}

export async function handleAddPipelineTask(
  pipelineSlug: string,
  taskSlug: string,
  root: string
): Promise<void> {
  if (!KEBAB_CASE_REGEX.test(pipelineSlug)) {
    console.error(`Error: Invalid pipeline slug "${pipelineSlug}". Must match /^[a-z0-9-]+$/`);
    process.exit(1);
    return;
  }
  if (!KEBAB_CASE_REGEX.test(taskSlug)) {
    console.error(`Error: Invalid task slug "${taskSlug}". Must match /^[a-z0-9-]+$/`);
    process.exit(1);
    return;
  }

  const tasksDir = join(root, "pipeline-config", pipelineSlug, "tasks");

  try {
    await access(tasksDir);
  } catch {
    console.error(`Error: Pipeline tasks directory not found: ${tasksDir}`);
    process.exit(1);
    return;
  }

  const indexPath = join(tasksDir, "index.ts");
  let indexContent: string;
  try {
    indexContent = await Bun.file(indexPath).text();
  } catch (err) {
    console.error(`Error reading tasks/index.ts: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  const entries = parseTaskIndex(indexContent);
  if (entries === null) {
    console.error(
      `Error: tasks/index.ts has been manually modified and cannot be parsed. Expected format: export default { "key": "./path.ts", ... };`
    );
    process.exit(1);
    return;
  }

  try {
    const taskFilePath = join(tasksDir, `${taskSlug}.ts`);
    const taskContent = generateTaskFileContent(taskSlug);
    await Bun.write(taskFilePath, taskContent);

    entries.set(taskSlug, `./${taskSlug}.ts`);
    await Bun.write(indexPath, serializeTaskIndex(entries));

    await updatePipelineJson(root, pipelineSlug, taskSlug);
  } catch (err) {
    console.error(`Error creating pipeline task: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── analyze ─────────────────────────────────────────────────────────────────

export async function handleAnalyze(taskPath: string): Promise<void> {
  await analyzeTaskFile(taskPath);
}

// ─── Hidden: _start-ui ───────────────────────────────────────────────────────

async function handleStartUi(): Promise<void> {
  const { startServer } = await import("../ui/server/index.ts");
  await startServer({
    dataDir: process.env["PO_ROOT"] ?? process.cwd(),
    port: parseInt(process.env["PORT"] ?? "4000", 10),
  });
}

// ─── Hidden: _start-orchestrator ─────────────────────────────────────────────

async function handleStartOrchestrator(): Promise<void> {
  if (!process.env["PO_ROOT"]) {
    console.error("Error: PO_ROOT environment variable is required");
    process.exit(1);
  }
  const { startOrchestrator } = await import("../core/orchestrator.ts");
  const handle = await startOrchestrator({ dataDir: process.env["PO_ROOT"] });
  process.on("SIGINT", () => {
    void handle.stop().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void handle.stop().then(() => process.exit(0));
  });
}

// ─── Hidden: _run-job ─────────────────────────────────────────────────────────

async function handleRunJob(jobId: string): Promise<void> {
  const { runPipelineJob } = await import("../core/pipeline-runner.ts");
  await runPipelineJob(jobId);
}

// ─── Commander program ────────────────────────────────────────────────────────

const program = new Command();

program
  .name("pipeline-orchestrator")
  .description("Prompt Orchestration Pipeline CLI")
  .version("0.17.5");

program
  .command("init")
  .description("Initialize pipeline workspace directories")
  .option("--root <path>", "Root directory", "./pipelines")
  .action(async (opts: { root: string }) => {
    await handleInit(opts.root);
  });

program
  .command("start")
  .description("Start the UI server and orchestrator")
  .option("--root <path>", "Root directory")
  .option("--port <port>", "UI server port", "4000")
  .action(async (opts: { root?: string; port: string }) => {
    await handleStart(opts.root, opts.port);
  });

program
  .command("submit <seed-file>")
  .description("Submit a job from a seed JSON file")
  .action(async (seedFile: string) => {
    await handleSubmit(seedFile);
  });

program
  .command("status [job-name]")
  .description("Query job status")
  .action(async (jobName: string | undefined) => {
    await handleStatus(jobName);
  });

program
  .command("add-pipeline <slug>")
  .description("Scaffold a new pipeline")
  .option("--root <path>", "Root directory", "./pipelines")
  .action(async (slug: string, opts: { root: string }) => {
    await handleAddPipeline(slug, opts.root);
  });

program
  .command("add-pipeline-task <pipeline-slug> <task-slug>")
  .description("Add a task to an existing pipeline")
  .option("--root <path>", "Root directory", "./pipelines")
  .action(async (pipelineSlug: string, taskSlug: string, opts: { root: string }) => {
    await handleAddPipelineTask(pipelineSlug, taskSlug, opts.root);
  });

program
  .command("analyze <task-path>")
  .description("Run static analysis on a task file")
  .action(async (taskPath: string) => {
    await handleAnalyze(taskPath);
  });

// Hidden subcommands
const startUiCmd = new Command("_start-ui")
  .description("(internal) Start the UI server")
  .action(async () => {
    await handleStartUi();
  });
program.addCommand(startUiCmd, { hidden: true });

const startOrchestratorCmd = new Command("_start-orchestrator")
  .description("(internal) Start the orchestrator")
  .action(async () => {
    await handleStartOrchestrator();
  });
program.addCommand(startOrchestratorCmd, { hidden: true });

const runJobCmd = new Command("_run-job")
  .description("(internal) Run a pipeline job")
  .argument("<job-id>", "Job ID to run")
  .action(async (jobId: string) => {
    await handleRunJob(jobId);
  });
program.addCommand(runJobCmd, { hidden: true });

// Export handlers for testing
export {
  generateTaskFileContent,
  parseTaskIndex,
  serializeTaskIndex,
};

// Only parse args when run directly
if (import.meta.main) {
  program.parse();
}
