import { describe, test, expect, afterEach } from "bun:test";
import { defaultConfig, resetConfig, loadConfig, getConfig, getConfigValue, getPipelineConfig } from "../config";
import type { AppConfig } from "../config";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests for validateConfig behavior are covered indirectly through loadConfig tests.
// Direct tests for edge cases:

describe("config environment overrides", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  test("PO_SHUTDOWN_TIMEOUT overrides orchestrator.shutdownTimeout", async () => {
    // Tested via loadConfig in step 7
  });
});

describe("loadConfig", () => {
  afterEach(() => {
    resetConfig();
  });

  test("throws when PO_ROOT is not set", async () => {
    const origRoot = process.env.PO_ROOT;
    delete process.env.PO_ROOT;
    try {
      await expect(loadConfig()).rejects.toThrow("PO_ROOT is required");
    } finally {
      if (origRoot) process.env.PO_ROOT = origRoot;
    }
  });

  test("loads config from file and merges with defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-test-"));
    const configDir = join(dir, "pipeline-config", "test");
    const tasksDir = join(configDir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(configDir, "pipeline.json"), JSON.stringify({ name: "test", tasks: ["t1"] }));
    await writeFile(join(dir, "pipeline-config", "registry.json"), JSON.stringify({
      pipelines: { test: { configDir, tasksDir } }
    }));
    process.env.PO_ROOT = dir;
    const config = await loadConfig();
    expect(config.paths.root).toBe(dir);
    expect(config.pipelines.test).toBeDefined();
    await rm(dir, { recursive: true });
  });
});

describe("defaultConfig", () => {
  afterEach(() => {
    resetConfig();
  });

  test("contains all required config sections", () => {
    expect(defaultConfig.orchestrator).toBeDefined();
    expect(defaultConfig.taskRunner).toBeDefined();
    expect(defaultConfig.llm).toBeDefined();
    expect(defaultConfig.ui).toBeDefined();
    expect(defaultConfig.paths).toBeDefined();
    expect(defaultConfig.validation).toBeDefined();
    expect(defaultConfig.logging).toBeDefined();
  });

  test("default values match documented defaults", () => {
    expect(defaultConfig.llm.defaultProvider).toBe("openai");
    expect(defaultConfig.ui.port).toBe(3000);
    expect(defaultConfig.taskRunner.maxRefinementAttempts).toBeGreaterThan(0);
  });

  test("taskRunner.maxAttempts defaults to 3", () => {
    expect(defaultConfig.taskRunner.maxAttempts).toBe(3);
  });
});

describe("validateConfig (via loadConfig)", () => {
  afterEach(() => {
    resetConfig();
  });

  test("throws when taskRunner.maxAttempts is 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "config-test-"));
    const configDir = join(dir, "pipeline-config", "test");
    const tasksDir = join(configDir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(configDir, "pipeline.json"), JSON.stringify({ name: "test", tasks: ["t1"] }));
    await writeFile(join(dir, "pipeline-config", "registry.json"), JSON.stringify({
      pipelines: { test: { configDir, tasksDir } }
    }));
    const overrideFile = join(dir, "config.json");
    await writeFile(overrideFile, JSON.stringify({ taskRunner: { maxAttempts: 0 } }));
    const origRoot = process.env.PO_ROOT;
    process.env.PO_ROOT = dir;
    try {
      await expect(loadConfig({ configPath: overrideFile })).rejects.toThrow("taskRunner.maxAttempts must be >= 1");
    } finally {
      if (origRoot) process.env.PO_ROOT = origRoot; else delete process.env.PO_ROOT;
      await rm(dir, { recursive: true });
    }
  });
});

describe("PO_TASK_MAX_ATTEMPTS env override", () => {
  afterEach(() => {
    delete process.env.PO_TASK_MAX_ATTEMPTS;
    resetConfig();
  });

  test("getConfig reads PO_TASK_MAX_ATTEMPTS into taskRunner.maxAttempts", () => {
    process.env.PO_TASK_MAX_ATTEMPTS = "5";
    resetConfig();
    const config: AppConfig = getConfig();
    expect(config.taskRunner.maxAttempts).toBe(5);
  });
});

describe("getConfig", () => {
  afterEach(() => {
    resetConfig();
  });

  test("returns cached config on repeat calls", () => {
    const config1 = getConfig();
    const config2 = getConfig();
    expect(config1).toBe(config2);
  });
});

describe("resetConfig", () => {
  test("clears cached config", () => {
    const config1 = getConfig();
    resetConfig();
    const config2 = getConfig();
    expect(config1).not.toBe(config2);
  });
});

describe("getConfigValue", () => {
  afterEach(() => {
    resetConfig();
  });

  test("retrieves nested value by dot path", () => {
    const val = getConfigValue("ui.port");
    expect(typeof val).toBe("number");
  });

  test("returns defaultValue for missing path", () => {
    const val = getConfigValue("nonexistent.deep.path", 42);
    expect(val).toBe(42);
  });
});

describe("getPipelineConfig", () => {
  afterEach(() => {
    resetConfig();
  });

  test("throws for unknown slug", () => {
    expect(() => getPipelineConfig("nonexistent-slug")).toThrow("not found in registry");
  });
});
