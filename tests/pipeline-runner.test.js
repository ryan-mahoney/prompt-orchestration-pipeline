// tests/pipeline-runner.test.js
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { vi, test, expect } from "vitest";

test("runs one task and writes artifacts", async () => {
  const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "runner-"));
  vi.spyOn(process, "cwd").mockReturnValue(ROOT);
  vi.spyOn(process, "exit").mockImplementation(() => {}); // don't kill the test process

  const name = "testrun";
  const workDir = path.join(ROOT, "pipeline-data", "current", name);
  await fs.mkdir(path.join(workDir, "tasks"), { recursive: true });

  // Minimal project files the runner expects
  await fs.mkdir(path.join(ROOT, "pipeline-config"), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, "pipeline-config", "pipeline.json"),
    JSON.stringify({ tasks: ["hello"] })
  );
  await fs.mkdir(path.join(ROOT, "pipeline-config", "tasks"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(ROOT, "pipeline-config", "tasks", "index.js"),
    `export default { hello: "${path.join(ROOT, "pipeline-tasks", "noop.js")}" };`,
    "utf8"
  );
  // Also create the task registry at the expected location
  await fs.mkdir(path.join(ROOT, "pipeline-config", "tasks"), {
    recursive: true,
  });
  // Create the task module in pipeline-tasks where the task runner expects it
  await fs.mkdir(path.join(ROOT, "pipeline-tasks"), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, "pipeline-tasks", "noop.js"),
    `export default {
      ingestion: (ctx) => ({ ...ctx, data: "test" }),
      preProcessing: (ctx) => ({ ...ctx, processed: true }),
      promptTemplating: (ctx) => ({ ...ctx, prompt: "test prompt" }),
      inference: (ctx) => ({ ...ctx, response: "test response" }),
      parsing: (ctx) => ({ ...ctx, parsed: { x: 1 } }),
      validateStructure: (ctx) => ({ ...ctx, validationPassed: true }),
      validateQuality: (ctx) => ({ ...ctx, qualityPassed: true }),
      finalValidation: (ctx) => ({ ...ctx, output: { x: 1 } })
    };`,
    "utf8"
  );

  await fs.writeFile(
    path.join(workDir, "seed.json"),
    JSON.stringify({ seed: true })
  );
  await fs.writeFile(
    path.join(workDir, "tasks-status.json"),
    JSON.stringify({ pipelineId: "p1", current: null, tasks: {} }, null, 2)
  );

  const prevArgv = process.argv;
  process.argv = [prevArgv[0], prevArgv[1], name];

  // ✅ Avoid file:// URL; keep a literal specifier to silence the Vite warning
  try {
    await import("../src/core/pipeline-runner.js");
  } catch (error) {
    console.error("Pipeline runner import failed:", error);
    throw error;
  }

  const dest = path.join(ROOT, "pipeline-data", "complete", name);
  const output = JSON.parse(
    await fs.readFile(path.join(dest, "tasks/hello/output.json"), "utf8")
  );
  expect(output).toEqual({ x: 1 });

  const runs = await fs.readFile(
    path.join(ROOT, "pipeline-data", "complete", "runs.jsonl"),
    "utf8"
  );
  expect(runs).toContain('"name":"testrun"');

  process.argv = prevArgv;
});
