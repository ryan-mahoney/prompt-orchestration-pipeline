#!/usr/bin/env node
import { Command } from "commander";
import { submitJobWithValidation } from "../api/index.js";
import { PipelineOrchestrator } from "../api/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { updatePipelineJson } from "./update-pipeline-json.js";

// Derive package root for resolving internal paths regardless of host CWD
const currentFile = fileURLToPath(import.meta.url);
const PKG_ROOT = path.dirname(path.dirname(path.dirname(currentFile)));

// Canonical stage names that must match src/core/task-runner.js
const STAGE_NAMES = [
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

const program = new Command();

program
  .name("pipeline-orchestrator")
  .description("Pipeline orchestration system")
  .version("1.0.0")
  .option("-r, --root <path>", "Pipeline root (PO_ROOT)")
  .option("-p, --port <port>", "UI server port", "4000");

program
  .command("init")
  .description("Initialize pipeline configuration")
  .action(async () => {
    const globalOptions = program.opts();
    const root = globalOptions.root || path.resolve(process.cwd(), "pipelines");

    // Create directories
    await fs.mkdir(path.join(root, "pipeline-config"), { recursive: true });
    await fs.mkdir(path.join(root, "pipeline-data", "pending"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "pipeline-data", "current"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "pipeline-data", "complete"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "pipeline-data", "rejected"), {
      recursive: true,
    });

    // Create .gitkeep files
    await fs.writeFile(
      path.join(root, "pipeline-data", "pending", ".gitkeep"),
      ""
    );
    await fs.writeFile(
      path.join(root, "pipeline-data", "current", ".gitkeep"),
      ""
    );
    await fs.writeFile(
      path.join(root, "pipeline-data", "complete", ".gitkeep"),
      ""
    );
    await fs.writeFile(
      path.join(root, "pipeline-data", "rejected", ".gitkeep"),
      ""
    );

    // Write registry.json with exact required content
    const registryContent = { pipelines: {} };
    await fs.writeFile(
      path.join(root, "pipeline-config", "registry.json"),
      JSON.stringify(registryContent, null, 2) + "\n"
    );

    console.log(`Pipeline configuration initialized at ${root}`);
  });

program
  .command("start")
  .description("Start the pipeline orchestrator with UI server")
  .action(async () => {
    const globalOptions = program.opts();
    let root = globalOptions.root || process.env.PO_ROOT;
    const port = globalOptions.port || "4000";

    // Resolve absolute root path
    if (!root) {
      console.error(
        "PO_ROOT is required. Use --root or set PO_ROOT to your pipeline root (e.g., ./demo)."
      );
      process.exit(1);
    }

    const absoluteRoot = path.isAbsolute(root)
      ? root
      : path.resolve(process.cwd(), root);
    process.env.PO_ROOT = absoluteRoot;

    console.log(`Using PO_ROOT=${absoluteRoot}`);
    console.log(`UI port=${port}`);

    let uiChild = null;
    let orchestratorChild = null;
    let childrenExited = 0;
    let exitCode = 0;

    // Cleanup function to kill remaining children
    const cleanup = () => {
      if (uiChild && !uiChild.killed) {
        uiChild.kill("SIGTERM");
        setTimeout(() => {
          if (!uiChild.killed) uiChild.kill("SIGKILL");
        }, 5000);
      }
      if (orchestratorChild && !orchestratorChild.killed) {
        orchestratorChild.kill("SIGTERM");
        setTimeout(() => {
          if (!orchestratorChild.killed) orchestratorChild.kill("SIGKILL");
        }, 5000);
      }
    };

    // Handle parent process signals
    process.on("SIGINT", () => {
      console.log("\nReceived SIGINT, shutting down...");
      cleanup();
      process.exit(exitCode);
    });

    process.on("SIGTERM", () => {
      console.log("\nReceived SIGTERM, shutting down...");
      cleanup();
      process.exit(exitCode);
    });

    try {
      // Step d: Check for prebuilt UI assets
      const distPath = path.join(PKG_ROOT, "src/ui/dist");
      try {
        await fs.access(distPath);
        console.log("UI build found, skipping build step");
      } catch {
        console.error(
          "UI assets missing. This indicates a source checkout. Run 'npm run ui:build' locally or install dev deps."
        );
        process.exit(1);
      }

      // Step e: Spawn UI server
      console.log("Starting UI server...");
      const uiServerPath = path.join(PKG_ROOT, "src/ui/server.js");
      uiChild = spawn("node", [uiServerPath], {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          PO_ROOT: absoluteRoot,
          PORT: port,
          PO_UI_PORT: undefined, // Ensure PORT takes precedence
        },
      });

      // Pipe UI output with prefix
      uiChild.stdout.on("data", (data) => {
        console.log(`[ui] ${data.toString().trim()}`);
      });

      uiChild.stderr.on("data", (data) => {
        console.error(`[ui] ${data.toString().trim()}`);
      });

      // Step f: Spawn orchestrator
      console.log("Starting orchestrator...");
      const orchestratorPath = path.join(
        PKG_ROOT,
        "src/cli/run-orchestrator.js"
      );
      orchestratorChild = spawn("node", [orchestratorPath], {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          PO_ROOT: absoluteRoot,
        },
      });

      // Pipe orchestrator output with prefix
      orchestratorChild.stdout.on("data", (data) => {
        console.log(`[orc] ${data.toString().trim()}`);
      });

      orchestratorChild.stderr.on("data", (data) => {
        console.error(`[orc] ${data.toString().trim()}`);
      });

      // Step h: Kill-others-on-fail behavior
      const handleChildExit = (child, name) => {
        return (code, signal) => {
          console.log(
            `${name} process exited with code ${code}, signal ${signal}`
          );
          childrenExited++;

          if (code !== 0) {
            exitCode = code;
            console.log(`${name} failed, terminating other process...`);
            cleanup();
          }

          if (childrenExited === 2 || (code !== 0 && childrenExited === 1)) {
            process.exit(exitCode);
          }
        };
      };

      uiChild.on("exit", handleChildExit(uiChild, "UI"));
      orchestratorChild.on(
        "exit",
        handleChildExit(orchestratorChild, "Orchestrator")
      );

      // Handle child process errors
      uiChild.on("error", (error) => {
        console.error(`UI process error: ${error.message}`);
        exitCode = 1;
        cleanup();
        process.exit(1);
      });

      orchestratorChild.on("error", (error) => {
        console.error(`Orchestrator process error: ${error.message}`);
        exitCode = 1;
        cleanup();
        process.exit(1);
      });
    } catch (error) {
      console.error(`Failed to start pipeline: ${error.message}`);
      cleanup();
      process.exit(1);
    }
  });

program
  .command("submit <seed-file>")
  .description("Submit a new job")
  .action(async (seedFile) => {
    try {
      const seed = JSON.parse(await fs.readFile(seedFile, "utf8"));
      const result = await submitJobWithValidation({
        dataDir: process.cwd(),
        seedObject: seed,
      });

      if (result.success) {
        console.log(`Job submitted: ${result.jobId} (${result.jobName})`);
      } else {
        console.error(`Failed to submit job: ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error submitting job: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("status [job-name]")
  .description("Get job status")
  .action(async (jobName) => {
    const orchestrator = await PipelineOrchestrator.create({
      autoStart: false,
    });
    if (jobName) {
      const status = await orchestrator.getStatus(jobName);
      console.log(JSON.stringify(status, null, 2));
    } else {
      const jobs = await orchestrator.listJobs();
      console.table(jobs);
    }
  });

program
  .command("add-pipeline <pipeline-slug>")
  .description("Add a new pipeline configuration")
  .action(async (pipelineSlug) => {
    const globalOptions = program.opts();
    const root = globalOptions.root || path.resolve(process.cwd(), "pipelines");

    // Validate pipeline-slug is kebab-case
    const kebabCaseRegex = /^[a-z0-9-]+$/;
    if (!kebabCaseRegex.test(pipelineSlug)) {
      console.error("Invalid pipeline slug: must be kebab-case (a-z0-9-)");
      process.exit(1);
    }

    try {
      // Ensure directories exist
      const pipelineConfigDir = path.join(
        root,
        "pipeline-config",
        pipelineSlug
      );
      const tasksDir = path.join(pipelineConfigDir, "tasks");
      await fs.mkdir(tasksDir, { recursive: true });

      // Write pipeline.json
      const pipelineConfig = {
        name: pipelineSlug,
        version: "1.0.0",
        description: "New pipeline",
        tasks: [],
      };
      await fs.writeFile(
        path.join(pipelineConfigDir, "pipeline.json"),
        JSON.stringify(pipelineConfig, null, 2) + "\n"
      );

      // Write tasks/index.js
      await fs.writeFile(
        path.join(tasksDir, "index.js"),
        "export default {};\n"
      );

      // Update registry.json
      const registryPath = path.join(root, "pipeline-config", "registry.json");
      let registry = { pipelines: {} };

      try {
        const registryContent = await fs.readFile(registryPath, "utf8");
        registry = JSON.parse(registryContent);
        if (!registry.pipelines) {
          registry.pipelines = {};
        }
      } catch (error) {
        // If registry doesn't exist or is invalid, use empty registry
        registry = { pipelines: {} };
      }

      // Add/replace pipeline entry
      registry.pipelines[pipelineSlug] = {
        name: pipelineSlug,
        description: "New pipeline",
        pipelinePath: `pipeline-config/${pipelineSlug}/pipeline.json`,
        taskRegistryPath: `pipeline-config/${pipelineSlug}/tasks/index.js`,
      };

      // Write back registry
      await fs.writeFile(
        registryPath,
        JSON.stringify(registry, null, 2) + "\n"
      );

      console.log(`Pipeline "${pipelineSlug}" added successfully`);
    } catch (error) {
      console.error(`Error adding pipeline: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("add-pipeline-task <pipeline-slug> <task-slug>")
  .description("Add a new task to a pipeline")
  .action(async (pipelineSlug, taskSlug) => {
    const globalOptions = program.opts();
    const root = globalOptions.root || path.resolve(process.cwd(), "pipelines");

    // Validate both slugs are kebab-case
    const kebabCaseRegex = /^[a-z0-9-]+$/;
    if (!kebabCaseRegex.test(pipelineSlug)) {
      console.error("Invalid pipeline slug: must be kebab-case (a-z0-9-)");
      process.exit(1);
    }
    if (!kebabCaseRegex.test(taskSlug)) {
      console.error("Invalid task slug: must be kebab-case (a-z0-9-)");
      process.exit(1);
    }

    // Check if pipeline tasks directory exists
    const tasksDir = path.join(root, "pipeline-config", pipelineSlug, "tasks");
    try {
      await fs.access(tasksDir);
    } catch (error) {
      console.error(
        `Pipeline "${pipelineSlug}" not found. Run add-pipeline first.`
      );
      process.exit(1);
    }

    try {
      // Create task file with all stage exports
      const taskFileContent = STAGE_NAMES.map((stageName) => {
        if (stageName === "ingestion") {
          return `// Step 1: Ingestion, ${getStagePurpose(stageName)}
export const ingestion = async ({ io, llm, data: { seed }, meta, flags }) => {

  return { output: {}, flags };
}`;
        }
        const stepNumber = STAGE_NAMES.indexOf(stageName) + 1;
        return `// Step ${stepNumber}: ${stageName.charAt(0).toUpperCase() + stageName.slice(1)}, ${getStagePurpose(stageName)}
export const ${stageName} = async ({ io, llm, data, meta, flags }) => {

  return { output: {}, flags };
}`;
      }).join("\n\n");

      await fs.writeFile(
        path.join(tasksDir, `${taskSlug}.js`),
        taskFileContent + "\n"
      );

      // Update tasks/index.js
      const indexFilePath = path.join(tasksDir, "index.js");
      let taskIndex = {};

      try {
        const indexContent = await fs.readFile(indexFilePath, "utf8");
        // Parse the default export from the file
        const exportMatch = indexContent.match(
          /export default\s+({[\s\S]*?})\s*;?\s*$/
        );
        if (exportMatch) {
          // Use eval to parse the object (safe in this controlled context)
          taskIndex = eval(`(${exportMatch[1]})`);
        }
      } catch (error) {
        // If file is missing or invalid, start with empty object
        taskIndex = {};
      }

      // Add/replace task mapping
      taskIndex[taskSlug] = `./${taskSlug}.js`;

      // Sort keys alphabetically for stable output
      const sortedKeys = Object.keys(taskIndex).sort();
      const sortedIndex = {};
      for (const key of sortedKeys) {
        sortedIndex[key] = taskIndex[key];
      }

      // Write back the index file with proper formatting
      const indexContent = `export default ${JSON.stringify(sortedIndex, null, 2)};\n`;
      await fs.writeFile(indexFilePath, indexContent);

      // Update pipeline.json to include the new task
      await updatePipelineJson(root, pipelineSlug, taskSlug);

      console.log(`Task "${taskSlug}" added to pipeline "${pipelineSlug}"`);
    } catch (error) {
      console.error(`Error adding task: ${error.message}`);
      process.exit(1);
    }
  });

// Helper function to get stage purpose descriptions
function getStagePurpose(stageName) {
  const purposes = {
    ingestion:
      "load/shape input for downstream stages (no external side-effects required)",
    preProcessing: "prepare and clean data for main processing",
    promptTemplating: "generate or format prompts for LLM interaction",
    inference: "execute LLM calls or other model inference",
    parsing: "extract and structure results from model outputs",
    validateStructure: "ensure output meets expected format and schema",
    validateQuality: "check content quality and completeness",
    critique: "analyze and evaluate results against criteria",
    refine: "improve and optimize outputs based on feedback",
    finalValidation: "perform final checks before completion",
    integration: "integrate results into downstream systems or workflows",
  };
  return purposes[stageName] || "handle stage-specific processing";
}

program.parse();
