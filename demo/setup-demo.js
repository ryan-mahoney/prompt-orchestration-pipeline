#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

async function setupDemo() {
  console.log("🚀 Setting up Prompt-Orchestration Pipeline Demo...\n");

  try {
    // Create directory structure
    await createDirectories();

    // Create configuration files
    await createConfigFiles();

    // Create sample seed files
    await createSeedFiles();

    // Verify setup
    await verifySetup();

    console.log("\n✅ Demo setup completed successfully!");
    console.log("\nQuick start commands:");
    console.log("  npm run demo           # Run renewable energy demo");
    console.log("  npm run demo:ai        # Run AI market demo");
    console.log("  npm run demo:simple    # Run simple EV demo");
    console.log("  npm run demo:list      # List available scenarios");
    console.log("\nView results in: ./demo-output/\n");
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
    process.exit(1);
  }
}

async function createDirectories() {
  console.log("📁 Creating directory structure...");

  const directories = [
    "pipeline-current",
    "pipeline-complete",
    "pipeline-pending",
    "pipeline-tasks",
    "demo-output",
    "task-runner",
  ];

  for (const dir of directories) {
    await fs.mkdir(dir, { recursive: true });
    console.log(`   ✓ Created ${dir}/`);
  }
}

async function createConfigFiles() {
  console.log("\n⚙️  Creating configuration files...");

  // pipeline.json
  const pipelineConfig = {
    tasks: ["data-extraction", "analysis", "report-generation"],
    config: {
      retryPolicy: {
        maxRetries: 3,
        retryableStages: ["validateStructure", "validateQuality"],
      },
      models: {
        fast: "gpt-3.5-turbo",
        accurate: "gpt-4",
        premium: "gpt-4-turbo",
      },
    },
  };

  await fs.writeFile("pipeline.json", JSON.stringify(pipelineConfig, null, 2));
  console.log("   ✓ Created pipeline.json");

  // pipeline-tasks/index.js
  const taskRegistry = {
    "data-extraction": "./data-extraction.js",
    analysis: "./analysis.js",
    "report-generation": "./report-generation.js",
  };

  await fs.writeFile(
    path.join("pipeline-tasks", "index.js"),
    `export default ${JSON.stringify(taskRegistry, null, 2)};`
  );
  console.log("   ✓ Created pipeline-tasks/index.js");
}

async function createSeedFiles() {
  console.log("\n🌱 Creating demo seed files...");

  const seeds = {
    "renewable-energy-seed.json": {
      id: "renewable-energy-001",
      type: "market-research",
      input: {
        industry: "renewable-energy",
        region: "north-america",
        timeframe: "2024-2025",
      },
      requirements: {
        outputFormat: "executive-summary",
        sections: ["market-size", "trends", "competitors", "opportunities"],
        maxLength: 2000,
      },
      metadata: {
        requestedBy: "strategy-team",
        priority: "high",
        deadline: "2024-12-15",
      },
    },

    "ai-market-seed.json": {
      id: "ai-market-002",
      type: "competitive-analysis",
      input: {
        industry: "artificial-intelligence",
        region: "global",
        timeframe: "2024-2025",
      },
      requirements: {
        outputFormat: "detailed-report",
        sections: [
          "market-dynamics",
          "key-players",
          "technology-trends",
          "investment-flows",
        ],
        maxLength: 3000,
      },
      metadata: {
        requestedBy: "product-team",
        priority: "medium",
        deadline: "2025-01-30",
      },
    },

    "simple-test-seed.json": {
      id: "test-001",
      type: "quick-analysis",
      input: {
        industry: "electric-vehicles",
        region: "united-states",
        timeframe: "2024",
      },
      requirements: {
        outputFormat: "brief-summary",
        sections: ["market-size", "growth"],
        maxLength: 1000,
      },
      metadata: {
        requestedBy: "demo-user",
        priority: "low",
        deadline: "2024-12-31",
      },
    },
  };

  for (const [filename, content] of Object.entries(seeds)) {
    await fs.writeFile(
      path.join("pipeline-pending", filename),
      JSON.stringify(content, null, 2)
    );
    console.log(`   ✓ Created pipeline-pending/${filename}`);
  }
}

async function verifySetup() {
  console.log("\n🔍 Verifying setup...");

  const requiredFiles = [
    "pipeline.json",
    "pipeline-tasks/index.js",
    "pipeline-pending/renewable-energy-seed.json",
    "integrated-demo-runner.js",
    "mock-chatgpt.js",
  ];

  const missingFiles = [];

  for (const file of requiredFiles) {
    try {
      await fs.access(file);
      console.log(`   ✓ ${file}`);
    } catch {
      missingFiles.push(file);
      console.log(`   ❌ ${file} - MISSING`);
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(`Missing required files: ${missingFiles.join(", ")}`);
  }

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0]);

  if (majorVersion < 18) {
    console.log(
      `   ⚠️  Node.js ${nodeVersion} detected. Recommended: Node.js 18+`
    );
  } else {
    console.log(`   ✓ Node.js ${nodeVersion}`);
  }
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDemo().catch(console.error);
}

export { setupDemo };
