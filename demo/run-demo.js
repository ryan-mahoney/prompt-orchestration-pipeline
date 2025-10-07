#!/usr/bin/env node

import { createPipelineOrchestrator, submitJob } from "../src/api/index.js";
import { readFile } from "node:fs/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure demo runs in production-like mode by default
process.env.NODE_ENV = process.env.NODE_ENV || "production";

async function runDemo(scenarioName) {
  console.log(`\n🚀 Starting Demo: ${scenarioName}\n`);

  try {
    // Check if UI build files are available
    const uiBuildPath = path.join(
      __dirname,
      "..",
      "src",
      "ui",
      "dist",
      "index.html"
    );

    let uiEnabled = true;
    try {
      await fs.access(uiBuildPath);
    } catch (error) {
      console.error("⚠️  UI build files are missing.");
      console.error(
        "Run 'npm run ui:build' from the project root, then re-run the demo."
      );
      process.exit(1);
    }

    // Initialize orchestrator
    const state = await createPipelineOrchestrator({
      rootDir: __dirname,
      configDir: "pipeline-config",
      dataDir: "pipeline-data",
      autoStart: true,
      ui: uiEnabled,
      uiPort: 4123,
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

    if (uiEnabled) {
      console.log(`\n🌐 Monitor at: http://localhost:4123`);
      console.log("\nPress Ctrl+C to stop the orchestrator");
    } else {
      console.log("\n💡 Tip: Run 'npm run ui:build' to enable UI monitoring");
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
  OPENAI_API_KEY    Your OpenAI API key (required)
      `);
  }
}

main().catch(console.error);
