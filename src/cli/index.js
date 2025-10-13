#!/usr/bin/env node
import { Command } from "commander";
import { submitJobWithValidation } from "../api/index.js";
import { PipelineOrchestrator } from "../api/index.js";
import fs from "node:fs/promises";
import path from "node:path";

const program = new Command();

program
  .name("pipeline-orchestrator")
  .description("Pipeline orchestration system")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize pipeline configuration")
  .action(async () => {
    const template = {
      pipeline: {
        name: "my-pipeline",
        version: "1.0.0",
        tasks: ["example-task"],
      },
      tasks: {
        "example-task": {
          ingestion:
            'export async function ingestion(context) { return { data: "example" }; }',
          inference:
            "export async function inference(context) { return { output: context.data }; }",
        },
      },
    };
    await fs.mkdir("pipeline-config/tasks/example-task", { recursive: true });
    await fs.writeFile(
      "pipeline-config/pipeline.json",
      JSON.stringify(template.pipeline, null, 2)
    );
    await fs.writeFile(
      "pipeline-config/tasks/index.js",
      `export default {\n  'example-task': './example-task/index.js'\n};`
    );
    await fs.writeFile(
      "pipeline-config/tasks/example-task/index.js",
      `${template.tasks["example-task"].ingestion}\n\n${template.tasks["example-task"].inference}\n`
    );
    console.log("Pipeline configuration initialized");
  });

program
  .command("start")
  .description("Start the pipeline orchestrator")
  .option("-u, --ui", "Start with UI server")
  .option("-p, --port <port>", "UI server port", "3000")
  .action(async (options) => {
    const orchestrator = new PipelineOrchestrator({
      ui: options.ui,
      uiPort: parseInt(options.port),
    });
    await orchestrator.initialize();
    console.log("Pipeline orchestrator started");
    process.on("SIGINT", async () => {
      await orchestrator.stop();
      process.exit(0);
    });
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
    const orchestrator = new PipelineOrchestrator({ autoStart: false });
    await orchestrator.initialize();
    if (jobName) {
      const status = await orchestrator.getStatus(jobName);
      console.log(JSON.stringify(status, null, 2));
    } else {
      const jobs = await orchestrator.listJobs();
      console.table(jobs);
    }
  });

program.parse();
