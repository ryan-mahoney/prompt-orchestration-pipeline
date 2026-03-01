import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execSync } from "node:child_process";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const BINARY_PATH = path.join(os.tmpdir(), `pipeline-orchestrator-smoke-${Date.now()}`);

let tempRoot;

beforeAll(async () => {
  // Build the compiled binary (externalize vite — dev-only, not needed at runtime)
  console.log("Building compiled binary...");
  execSync(
    `bun build ${path.join(PROJECT_ROOT, "src/cli/index.js")} --compile --outfile ${BINARY_PATH} --external vite`,
    { cwd: PROJECT_ROOT, stdio: "pipe", timeout: 60000 }
  );

  // Verify binary exists
  const stat = await fs.stat(BINARY_PATH);
  expect(stat.isFile()).toBe(true);

  // Create temp pipeline root
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-"));
}, 120000);

afterAll(async () => {
  // Cleanup
  try {
    await fs.unlink(BINARY_PATH);
  } catch {}
  try {
    await fs.rm(tempRoot, { recursive: true, force: true });
  } catch {}
});

describe("compiled binary smoke tests", () => {
  it("shows help output", () => {
    const result = execSync(`${BINARY_PATH} --help`, {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result).toContain("pipeline-orchestrator");
    expect(result).toContain("init");
    expect(result).toContain("start");
    expect(result).toContain("submit");
  }, 15000);

  it("runs init command to create pipeline structure", () => {
    const initRoot = path.join(tempRoot, "pipelines");
    execSync(`${BINARY_PATH} init --root ${initRoot}`, {
      encoding: "utf8",
      timeout: 10000,
    });

    // Verify directories were created
    const pendingExists = require("fs").existsSync(
      path.join(initRoot, "pipeline-data", "pending")
    );
    const currentExists = require("fs").existsSync(
      path.join(initRoot, "pipeline-data", "current")
    );
    const registryExists = require("fs").existsSync(
      path.join(initRoot, "pipeline-config", "registry.json")
    );

    expect(pendingExists).toBe(true);
    expect(currentExists).toBe(true);
    expect(registryExists).toBe(true);
  }, 15000);

  it("runs add-pipeline command", () => {
    const initRoot = path.join(tempRoot, "pipelines");
    execSync(`${BINARY_PATH} add-pipeline test-pipeline --root ${initRoot}`, {
      encoding: "utf8",
      timeout: 10000,
    });

    const pipelineJson = require("fs").existsSync(
      path.join(initRoot, "pipeline-config", "test-pipeline", "pipeline.json")
    );
    expect(pipelineJson).toBe(true);
  }, 15000);

  it("keeps internal self-reexec commands hidden from help output", () => {
    const result = execSync(`${BINARY_PATH} --help`, {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result).not.toContain("_start-ui");
    expect(result).not.toContain("_run-job");
  }, 15000);
});
