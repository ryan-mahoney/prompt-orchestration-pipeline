// Test utilities for Vitest tests
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { vi } from "vitest";

/**
 * Creates a temporary directory for testing
 */
export async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "test-"));
}

/**
 * Cleans up a temporary directory
 */
export async function cleanupTempDir(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Sets up a mock pipeline environment for testing
 */
export async function setupMockPipeline(overrides = {}) {
  const tempDir = await createTempDir();

  const config = {
    pipelineJson: { tasks: ["test-task"] },
    taskRegistry: { "test-task": "./test-task.js" },
    taskModule: "export default async () => ({ output: { test: true } });",
    seedData: { seed: true },
    ...overrides,
  };

  // Create pipeline config directory
  const configDir = path.join(tempDir, "pipeline-config");
  await fs.mkdir(configDir, { recursive: true });

  // Create pipeline.json
  await fs.writeFile(
    path.join(configDir, "pipeline.json"),
    JSON.stringify(config.pipelineJson, null, 2)
  );

  // Create tasks directory
  const tasksDir = path.join(configDir, "tasks");
  await fs.mkdir(tasksDir, { recursive: true });

  // Create task registry
  await fs.writeFile(
    path.join(tasksDir, "index.js"),
    `export default ${JSON.stringify(config.taskRegistry)};`
  );

  // Create task module
  await fs.writeFile(path.join(tasksDir, "test-task.js"), config.taskModule);

  return {
    tempDir,
    configDir,
    tasksDir,
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Mock environment variables for testing
 */
export function mockEnvVars(envVars = {}) {
  const originalEnv = { ...process.env };

  Object.entries(envVars).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  return () => {
    process.env = originalEnv;
  };
}

/**
 * Mock process.argv for testing
 */
export function mockProcessArgv(args = []) {
  const originalArgv = [...process.argv];
  process.argv = [process.argv[0], process.argv[1], ...args];

  return () => {
    process.argv = originalArgv;
  };
}

/**
 * Helper to wait for a condition
 */
export async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Create mock task runner functions
 */
export function createMockTaskRunner() {
  return {
    runPipeline: vi.fn().mockResolvedValue({
      ok: true,
      context: { output: { test: true } },
      logs: [{ stage: "test", ok: true, ms: 10 }],
      refinementAttempts: 0,
    }),
    runPipelineWithModelRouting: vi.fn().mockResolvedValue({
      ok: true,
      context: { output: { test: true } },
      logs: [{ stage: "test", ok: true, ms: 10 }],
      refinementAttempts: 0,
    }),
    selectModel: vi.fn().mockReturnValue("gpt-4"),
  };
}

/**
 * Reset all mocks and restore environment
 */
export function resetTestEnvironment() {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.restoreAllMocks();

  // Clean up any global test state
  if (global.__mockTasks) {
    delete global.__mockTasks;
  }
}
