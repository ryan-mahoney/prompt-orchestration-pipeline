// tests/pipeline-runner.test.js
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { vi, test, expect } from "vitest";

// ✅ Hoisted-safe: use a STRING LITERAL here
vi.mock("../src/task-runner.js", () => ({
  runPipeline: vi.fn().mockResolvedValue({
    ok: true,
    context: { output: { x: 1 } },
    logs: [{ ms: 7 }],
    refinementAttempts: 0,
  }),
}));

test("runs one task and writes artifacts", async () => {
  vi.resetModules();

  const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "runner-"));
  vi.spyOn(process, "cwd").mockReturnValue(ROOT);
  vi.spyOn(process, "exit").mockImplementation(() => {}); // don't kill the test process

  const name = "testrun";
  const workDir = path.join(ROOT, "pipeline-current", name);
  await fs.mkdir(path.join(workDir, "tasks"), { recursive: true });

  // Minimal project files the runner expects
  await fs.writeFile(
    path.join(ROOT, "pipeline.json"),
    JSON.stringify({ tasks: ["hello"] })
  );
  await fs.mkdir(path.join(ROOT, "pipeline-tasks"), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, "pipeline-tasks", "index.js"),
    'export default { hello: "./noop.js" };',
    "utf8"
  );
  await fs.writeFile(
    path.join(ROOT, "pipeline-tasks", "noop.js"),
    "export default async () => ({});",
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
  await import("../src/pipeline-runner.js");

  const dest = path.join(ROOT, "pipeline-complete", name);
  const output = JSON.parse(
    await fs.readFile(path.join(dest, "tasks/hello/output.json"), "utf8")
  );
  expect(output).toEqual({ x: 1 });

  const runs = await fs.readFile(
    path.join(ROOT, "pipeline-complete", "runs.jsonl"),
    "utf8"
  );
  expect(runs).toContain('"name":"testrun"');

  process.argv = prevArgv;
});
