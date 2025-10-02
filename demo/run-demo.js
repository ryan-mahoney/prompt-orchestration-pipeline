#!/usr/bin/env node

import { createPipelineOrchestrator, submitJob } from "../src/api/index.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runDemo(scenarioName) {
  console.log(`\n🚀 Starting Demo: ${scenarioName}\n`);

  try {
    // Initialize orchestrator
    const state = await createPipelineOrchestrator({
      rootDir: __dirname,
      configDir: "pipeline-config",
      dataDir: "pipeline-data",
      autoStart: true,
      ui: process.env.ENABLE_UI === "true",
      uiPort: 3000,
    });

    console.log("✅ Orchestrator initialized");

    // Load seed data
    const seedPath = path.join(__dirname, "seeds", `${scenarioName}.json`);
    const seed = JSON.parse(await readFile(seedPath, "utf8"));

    console.log(`📄 Loaded seed: ${seed.name}`);
    console.log(`📋 Type: ${seed.data.type}`);

    // Submit job
    const { name } = await submitJob(state, seed);
    console.log(`\n✅ Job submitted: ${name}`);

    if (process.env.ENABLE_UI === "true") {
      console.log(`\n🌐 Monitor at: http://localhost:3000`);
      console.log("\nPress Ctrl+C to stop the orchestrator");
    } else {
      console.log(
        "\n💡 Tip: Set ENABLE_UI=true to monitor progress in browser"
      );
      console.log("\nOrchestrator will process the job in the background.");
      console.log("Check demo/pipeline-data/complete/ for results.");
    }
  } catch (error) {
    console.error("\n❌ Demo failed:", error.message);
    process.exit(1);
  }
}

async function listScenarios() {
  console.log("\n📋 Available Demo Scenarios:\n");
  console.log("  • market-analysis      - Multi-stage market research");
  console.log("  • content-generation   - Content creation workflow");
  console.log("  • data-processing      - Data extraction and transformation");
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  switch (command) {
    case "run":
      const scenario = args[1] || "market-analysis";
      await runDemo(scenario);
      break;

    case "list":
      await listScenarios();
      break;

    case "help":
    default:
      console.log(`
Prompt Orchestration Pipeline - Demo

Usage: node run-demo.js [command] [options]

Commands:
  run [scenario]    Run a demo scenario (default: market-analysis)
  list              List available scenarios
  help              Show this help message

Examples:
  node run-demo.js run market-analysis
  node run-demo.js run content-generation
  node run-demo.js list

Environment Variables:
  ENABLE_UI=true    Enable web UI for monitoring
  OPENAI_API_KEY    Your OpenAI API key (required)
      `);
  }
}

main().catch(console.error);
