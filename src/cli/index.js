#!/usr/bin/env node
import { Command } from "commander";
import { submitJobWithValidation } from "../api/index.js";
import { PipelineOrchestrator } from "../api/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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
      // Step d: Build UI once if dist/ doesn't exist
      const distPath = path.join(process.cwd(), "dist");
      try {
        await fs.access(distPath);
        console.log("UI build found, skipping build step");
      } catch {
        console.log("Building UI...");
        await new Promise((resolve, reject) => {
          const vitePath = path.resolve(
            process.cwd(),
            "node_modules/vite/bin/vite.js"
          );
          const buildChild = spawn("node", [vitePath, "build"], {
            stdio: "inherit",
            env: { ...process.env, NODE_ENV: "development" },
          });

          buildChild.on("exit", (code) => {
            if (code === 0) {
              console.log("UI build completed");
              resolve();
            } else {
              reject(new Error(`UI build failed with code ${code}`));
            }
          });

          buildChild.on("error", reject);
        });
      }

      // Step e: Spawn UI server
      console.log("Starting UI server...");
      const uiServerPath = path.resolve(process.cwd(), "src/ui/server.js");
      uiChild = spawn("node", [uiServerPath], {
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          PO_ROOT: absoluteRoot,
          PO_UI_PORT: port,
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
      const orchestratorPath = path.resolve(
        process.cwd(),
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

program.parse();
