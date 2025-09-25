import fs from "fs";
import path from "path";

// pipeline.json
export const pipelineConfig = {
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

// pipeline-tasks/index.js
export const taskRegistry = {
  "data-extraction": "data-extraction/index.js",
  analysis: "analysis/index.js",
  "report-generation": "report-generation/index.js",
};

// Example seed files for testing
export const demoSeeds = {
  // Renewable energy market research
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

  // AI/ML market analysis
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

  // Simple test case
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

// Helper to write config files
export function writeConfigFiles() {
  // Write pipeline.json
  fs.writeFileSync("pipeline.json", JSON.stringify(pipelineConfig, null, 2));

  // Create pipeline-tasks directory and index
  if (!fs.existsSync("pipeline-tasks")) {
    fs.mkdirSync("pipeline-tasks");
  }

  fs.writeFileSync(
    path.join("pipeline-tasks", "index.js"),
    `export default ${JSON.stringify(taskRegistry, null, 2)};`
  );

  // Create seed files
  if (!fs.existsSync("pipeline-pending")) {
    fs.mkdirSync("pipeline-pending");
  }

  Object.entries(demoSeeds).forEach(([filename, content]) => {
    fs.writeFileSync(
      path.join("pipeline-pending", filename),
      JSON.stringify(content, null, 2)
    );
  });

  console.log("✅ Demo configuration files created successfully!");
}

writeConfigFiles();
