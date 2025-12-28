#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import { Command } from "commander";
import { deduceArtifactSchema } from "../src/task-analysis/enrichers/schema-deducer.js";
import { writeSchemaFiles } from "../src/task-analysis/enrichers/schema-writer.js";

const MAX_RETRIES = 3;

const program = new Command();

program
  .name("deduce-schemas")
  .description("Deduce JSON schemas from task source code using LLM")
  .version("0.1.0")
  .requiredOption("-a, --analysis <path>", "Path to the JSON analysis file")
  .requiredOption("-t, --task <path>", "Path to the task source file")
  .option(
    "-o, --output <path>",
    "Output directory for schema files",
    "."
  )
  .parse(process.argv);

const options = program.opts();

async function main() {
  const { analysis, task, output } = options;

  // Read artifact analysis
  let analysisData;
  try {
    const content = await fs.readFile(analysis, "utf8");
    analysisData = JSON.parse(content);
  } catch (error) {
    console.error(`Error: Cannot read analysis file: ${analysis}`);
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Validate analysis structure
  if (!analysisData.artifacts || !analysisData.artifacts.writes) {
    console.error(
      "Error: Invalid analysis format. Expected 'artifacts.writes' array."
    );
    process.exit(1);
  }

  // Read task source code
  let taskCode;
  try {
    taskCode = await fs.readFile(task, "utf8");
  } catch (error) {
    console.error(`Error: Cannot read task file: ${task}`);
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Create output directory if it doesn't exist
  try {
    await fs.mkdir(output, { recursive: true });
  } catch (error) {
    console.error(`Error: Cannot create output directory: ${output}`);
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Filter for JSON artifacts only
  const jsonArtifacts = analysisData.artifacts.writes.filter((w) =>
    w.fileName.endsWith(".json")
  );

  console.log(`Found ${jsonArtifacts.length} JSON artifacts to process\n`);
  console.log(`Task file: ${task}`);
  console.log(`Output directory: ${output}\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < jsonArtifacts.length; i++) {
    const artifact = jsonArtifacts[i];
    console.log(
      `[${i + 1}/${jsonArtifacts.length}] Processing: ${artifact.fileName}`
    );

    // Retry loop for transient LLM failures
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await deduceArtifactSchema(taskCode, artifact);
        await writeSchemaFiles(output, artifact.fileName, result);
        console.log(`  ✓ Schema deduced and validated`);
        succeeded++;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          console.log(`  ⚠ Attempt ${attempt} failed, retrying...`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    if (lastError) {
      console.error(`  ✗ Failed: ${lastError.message}`);
      failed++;
    }
  }

  // Skip non-JSON artifacts with logging
  const nonJsonArtifacts = analysisData.artifacts.writes.filter(
    (w) => !w.fileName.endsWith(".json")
  );
  if (nonJsonArtifacts.length > 0) {
    console.log("\nSkipped non-JSON artifacts:");
    for (const artifact of nonJsonArtifacts) {
      console.log(`  - ${artifact.fileName}`);
    }
  }

  console.log(`\nSummary: ${succeeded} succeeded, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
