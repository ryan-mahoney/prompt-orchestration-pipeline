#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { demoSeeds } from "./demo-config.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PENDING_DIR = path.join(ROOT, "pipeline-pending");
const CURRENT_DIR = path.join(ROOT, "pipeline-current");
const COMPLETE_DIR = path.join(ROOT, "pipeline-complete");

class IntegratedDemo {
  constructor() {
    this.startTime = Date.now();
  }

  async runDemo(seedName = "renewable-energy") {
    console.log("\n🚀 Starting Full Pipeline System Demo\n");
    console.log("=".repeat(60));
    console.log("This demo uses the complete orchestration system:");
    console.log("• orchestrator.js (process management)");
    console.log("• pipeline-runner.js (outer pipeline)");
    console.log("• task-runner.js (inner pipeline)");
    console.log("• Individual task modules");
    console.log("=".repeat(60));

    // Get demo seed data
    const seed = this.getSeed(seedName);
    console.log(`📋 Demo Scenario: ${seed.type.toUpperCase()}`);
    console.log(`🎯 Industry: ${seed.input.industry}`);
    console.log(`🌍 Region: ${seed.input.region}`);
    console.log(`📅 Timeframe: ${seed.input.timeframe}`);
    console.log("=".repeat(60));

    // Clean up any existing runs
    await this.cleanup();

    // Create pipeline seed file
    const seedFileName = `${seedName}-${Date.now()}-seed.json`;
    const seedFilePath = path.join(PENDING_DIR, seedFileName);

    await fs.mkdir(PENDING_DIR, { recursive: true });
    await fs.writeFile(seedFilePath, JSON.stringify(seed, null, 2));

    console.log(`📁 Created seed file: ${seedFileName}`);
    console.log("🔄 Triggering pipeline...\n");

    // Run the pipeline using pipeline-runner.js directly
    const pipelineName = seedName + "-" + Date.now();
    await this.runPipelineRunner(pipelineName, seed);

    // Monitor and display results
    await this.monitorAndDisplayResults(pipelineName);
  }

  async runPipelineRunner(pipelineName, seed) {
    // Create the pipeline working directory manually
    const workDir = path.join(CURRENT_DIR, pipelineName);
    await fs.mkdir(workDir, { recursive: true });

    // Create required files
    const pipelineId = `pl-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;

    await fs.writeFile(
      path.join(workDir, "seed.json"),
      JSON.stringify(seed, null, 2)
    );

    await fs.writeFile(
      path.join(workDir, "tasks-status.json"),
      JSON.stringify(
        {
          pipelineId,
          name: pipelineName,
          current: null,
          createdAt: new Date().toISOString(),
          tasks: {},
        },
        null,
        2
      )
    );

    return new Promise((resolve, reject) => {
      console.log("🚀 Spawning pipeline-runner.js...\n");

      const child = spawn(
        process.execPath,
        [path.join(ROOT, "src/core/pipeline-runner.js"), pipelineName],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            PO_ROOT: ROOT,
            PO_DATA_DIR: path.join(ROOT, "pipeline-data"),
            PO_CURRENT_DIR: CURRENT_DIR,
            PO_COMPLETE_DIR: COMPLETE_DIR,
            PO_CONFIG_DIR: path.join(ROOT, "demo/pipeline-config"),
            PO_PIPELINE_PATH: path.join(
              ROOT,
              "demo/pipeline-config/pipeline.json"
            ),
            PO_TASK_REGISTRY: path.join(
              ROOT,
              "demo/pipeline-config/tasks/index.js"
            ),
          },
          cwd: ROOT,
        }
      );

      let output = "";
      let errorOutput = "";

      child.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text); // Show real-time output
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        errorOutput += text;
        process.stderr.write(text);
      });

      child.on("exit", (code, signal) => {
        if (code === 0) {
          console.log("\n✅ Pipeline runner completed successfully!\n");
          resolve({ code, output, errorOutput });
        } else {
          console.log(`\n❌ Pipeline runner failed with code ${code}\n`);
          reject(
            new Error(`Pipeline failed with code ${code}: ${errorOutput}`)
          );
        }
      });

      child.on("error", (err) => {
        console.log("\n❌ Failed to spawn pipeline runner:", err.message);
        reject(err);
      });
    });
  }

  async monitorAndDisplayResults(pipelineName) {
    console.log("📊 PIPELINE RESULTS");
    console.log("=".repeat(60));

    // Check if pipeline completed successfully
    const completedPath = path.join(COMPLETE_DIR, pipelineName);
    const currentPath = path.join(CURRENT_DIR, pipelineName);

    let resultsPath;
    let status = "unknown";

    try {
      await fs.access(completedPath);
      resultsPath = completedPath;
      status = "completed";
      console.log("✅ Pipeline Status: COMPLETED");
    } catch {
      try {
        await fs.access(currentPath);
        resultsPath = currentPath;
        status = "failed";
        console.log("❌ Pipeline Status: FAILED (check logs)");
      } catch {
        console.log("❓ Pipeline Status: UNKNOWN (no results found)");
        return;
      }
    }

    console.log(`📁 Results Location: ${resultsPath}`);

    try {
      // Read execution summary
      const statusFile = path.join(resultsPath, "tasks-status.json");
      const statusData = JSON.parse(await fs.readFile(statusFile, "utf8"));

      console.log(`🆔 Pipeline ID: ${statusData.pipelineId}`);
      console.log(
        `⏱️  Total Execution Time: ${((Date.now() - this.startTime) / 1000).toFixed(2)}s`
      );

      // Show task results
      console.log("\n📋 Task Execution Summary:");
      console.log("-".repeat(40));

      const taskResults = statusData.tasks || {};
      Object.entries(taskResults).forEach(([taskName, result]) => {
        const status = result.state === "done" ? "✅" : "❌";
        const timing = result.executionTime
          ? `(${result.executionTime}ms)`
          : "";
        console.log(`${status} ${taskName}: ${result.state} ${timing}`);

        if (result.error) {
          console.log(`   Error: ${result.error.message}`);
        }

        if (result.attempts > 1) {
          console.log(`   Retry attempts: ${result.attempts}`);
        }
      });

      // Show artifacts
      if (status === "completed") {
        await this.displayArtifacts(resultsPath);
      }

      // Show run history
      await this.showRunHistory();
    } catch (error) {
      console.log(`❌ Error reading results: ${error.message}`);
    }
  }

  async displayArtifacts(resultsPath) {
    console.log("\n📦 Generated Artifacts:");
    console.log("-".repeat(40));

    try {
      const tasksDir = path.join(resultsPath, "tasks");
      const tasks = await fs.readdir(tasksDir);

      for (const taskName of tasks) {
        const taskDir = path.join(tasksDir, taskName);
        const outputFile = path.join(taskDir, "output.json");

        try {
          const output = JSON.parse(await fs.readFile(outputFile, "utf8"));
          console.log(`\n📄 ${taskName.toUpperCase()} OUTPUT:`);

          if (taskName === "report-generation" && output.reportContent) {
            // Show first 300 chars of final report
            console.log(output.reportContent.substring(0, 300) + "...\n");
            console.log(`📊 Report Stats:`);
            console.log(`   Word Count: ${output.wordCount || "N/A"}`);
            console.log(`   Report Type: ${output.reportType || "N/A"}`);
          } else if (output.extractedData) {
            // Show extracted data summary
            console.log(output.extractedData.substring(0, 200) + "...\n");
          } else if (output.analysisContent) {
            // Show analysis summary
            console.log(output.analysisContent.substring(0, 200) + "...\n");
          }

          if (output.metadata) {
            console.log(`   Model: ${output.metadata.model || "N/A"}`);
            console.log(
              `   Confidence: ${output.metadata.confidence || "N/A"}`
            );
            console.log(`   Tokens: ${output.metadata.tokens || "N/A"}`);
          }
        } catch {
          console.log(`   ⚠️  No output.json found for ${taskName}`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Error reading artifacts: ${error.message}`);
    }
  }

  async showRunHistory() {
    console.log("\n📈 Pipeline Run History:");
    console.log("-".repeat(40));

    try {
      const runsFile = path.join(COMPLETE_DIR, "runs.jsonl");
      const content = await fs.readFile(runsFile, "utf8");
      const runs = content
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      const recentRuns = runs.slice(-5); // Show last 5 runs

      recentRuns.forEach((run) => {
        console.log(`📋 ${run.name} (${run.finishedAt})`);
        console.log(`   Tasks: ${run.tasks.join(" → ")}`);
        console.log(`   Execution Time: ${run.totalExecutionTime || "N/A"}ms`);
      });

      if (runs.length > 5) {
        console.log(`   ... and ${runs.length - 5} more runs`);
      }
    } catch (error) {
      console.log("   No previous runs found");
    }
  }

  getSeed(seedName) {
    const seedMap = {
      "renewable-energy": demoSeeds["renewable-energy-seed.json"],
      //   "ai-market": demoSeeds["ai-market-seed.json"],
      //   "simple-test": demoSeeds["simple-test-seed.json"],
    };

    return seedMap[seedName] || seedMap["renewable-energy"];
  }

  async cleanup() {
    // Clean up any existing demo runs to start fresh
    try {
      const currentFiles = await fs.readdir(CURRENT_DIR);
      for (const file of currentFiles) {
        if (
          file.startsWith("renewable-energy") ||
          file.startsWith("ai-market") ||
          file.startsWith("simple-test")
        ) {
          await fs.rm(path.join(CURRENT_DIR, file), {
            recursive: true,
            force: true,
          });
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }
}

// Orchestrator simulation for standalone demo
async function runWithOrchestrator(seedName = "renewable-energy") {
  console.log("\n🎛️  Starting Orchestrator Demo\n");
  console.log("This simulates the full orchestrator.js workflow");
  console.log("=".repeat(60));

  const demo = new IntegratedDemo();
  const seed = demo.getSeed(seedName);

  // Create seed file in pending directory (simulates file drop)
  const seedFileName = `${seedName}-${Date.now()}-seed.json`;
  const seedFilePath = path.join(PENDING_DIR, seedFileName);

  await fs.mkdir(PENDING_DIR, { recursive: true });
  await fs.writeFile(seedFilePath, JSON.stringify(seed, null, 2));

  console.log(`📁 Seed file created: ${seedFileName}`);
  console.log("🔄 The orchestrator would automatically detect this file...");
  console.log("📋 For this demo, we'll run pipeline-runner.js directly\n");

  // Wait a moment to simulate file detection
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await demo.runDemo(seedName);
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "run";
  const seedName = args[1] || "renewable-energy";

  try {
    switch (command) {
      case "run":
        const demo = new IntegratedDemo();
        await demo.runDemo(seedName);
        break;

      case "orchestrator":
        await runWithOrchestrator(seedName);
        break;

      case "list-seeds":
        console.log("\n📋 Available demo seeds:");
        Object.entries(demoSeeds).forEach(([key, seed]) => {
          const name = key.replace("-seed.json", "");
          console.log(`  • ${name} - ${seed.type} (${seed.input.industry})`);
        });
        break;

      case "help":
        console.log(`
🚀 Integrated Pipeline System Demo

Usage: node integrated-demo.js [command] [options]

Commands:
  run [seed]         Run pipeline-runner.js directly (default)
  orchestrator [seed] Simulate full orchestrator workflow  
  list-seeds         Show available demo scenarios  
  help               Show this help message

Available seeds:
  • renewable-energy  - Renewable energy market analysis (default)
  • ai-market        - AI/ML market competitive analysis  
  • simple-test      - Simple electric vehicle analysis

Examples:
  node integrated-demo.js run renewable-energy
  node integrated-demo.js orchestrator ai-market
  node integrated-demo.js list-seeds
        `);
        break;

      default:
        console.log(`Unknown command: ${command}`);
        console.log(
          'Run "node integrated-demo.js help" for usage information.'
        );
        process.exit(1);
    }
  } catch (error) {
    console.error("❌ Demo failed:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { IntegratedDemo, runWithOrchestrator };
