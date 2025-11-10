import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadConfig,
  getConfig,
  resetConfig,
  getConfigValue,
  defaultConfig,
} from "../src/core/config.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Configuration Module", () => {
  let tempDir;
  let originalEnv;

  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env };

    // Create temp directory for test config files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));

    // Reset config before each test
    resetConfig();
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;

    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    // Reset config after each test
    resetConfig();
  });

  describe("defaultConfig", () => {
    it("should have all required configuration sections", () => {
      expect(defaultConfig).toHaveProperty("orchestrator");
      expect(defaultConfig).toHaveProperty("taskRunner");
      expect(defaultConfig).toHaveProperty("llm");
      expect(defaultConfig).toHaveProperty("ui");
      expect(defaultConfig).toHaveProperty("paths");
      expect(defaultConfig).toHaveProperty("validation");
      expect(defaultConfig).toHaveProperty("logging");
    });

    it("should have sensible default values", () => {
      expect(defaultConfig.orchestrator.shutdownTimeout).toBe(2000);
      expect(defaultConfig.taskRunner.maxRefinementAttempts).toBe(2);
      expect(defaultConfig.llm.defaultProvider).toBe("openai");
      expect(defaultConfig.ui.port).toBe(3000);
      expect(defaultConfig.logging.level).toBe("info");
    });

    it("should have llm.models registry that references centralized MODEL_CONFIG", () => {
      expect(defaultConfig.llm.models).toBeDefined();
      // The models registry should reference the centralized MODEL_CONFIG
      expect(typeof defaultConfig.llm.models).toBe("object");
      expect(Object.keys(defaultConfig.llm.models)).toContain("openai:gpt-4o");
      expect(Object.keys(defaultConfig.llm.models)).toContain(
        "openai:gpt-5-chat-latest"
      );
      expect(Object.keys(defaultConfig.llm.models)).toContain(
        "deepseek:reasoner"
      );
      expect(Object.keys(defaultConfig.llm.models)).toContain("deepseek:chat");
      expect(Object.keys(defaultConfig.llm.models)).toContain(
        "anthropic:sonnet-4-5"
      );
      expect(Object.keys(defaultConfig.llm.models)).toContain(
        "anthropic:opus-4-5"
      );

      // Verify structure of model entries (they should have provider and model properties)
      const sampleModel = defaultConfig.llm.models["openai:gpt-4o"];
      expect(sampleModel).toHaveProperty("provider");
      expect(sampleModel).toHaveProperty("model");
      expect(sampleModel.provider).toBe("openai");
    });
  });

  describe("getConfig", () => {
    it("should return default config on first call", () => {
      const config = getConfig();
      expect(config.orchestrator.shutdownTimeout).toBe(2000);
      expect(config.llm.defaultProvider).toBe("openai");
    });

    it("should return cached config on subsequent calls", () => {
      const config1 = getConfig();
      const config2 = getConfig();
      expect(config1).toBe(config2);
    });

    it("should load environment variables", () => {
      process.env.PO_SHUTDOWN_TIMEOUT = "5000";
      process.env.PO_DEFAULT_PROVIDER = "deepseek";
      resetConfig();

      const config = getConfig();
      expect(config.orchestrator.shutdownTimeout).toBe(5000);
      expect(config.llm.defaultProvider).toBe("deepseek");
    });
  });

  describe("loadConfig", () => {
    it("should load config from file", async () => {
      const configPath = path.join(tempDir, "test-config.json");
      const testConfig = {
        orchestrator: {
          shutdownTimeout: 3000,
        },
        llm: {
          defaultProvider: "anthropic",
        },
      };

      await fs.writeFile(configPath, JSON.stringify(testConfig));

      const config = await loadConfig({ configPath });
      expect(config.orchestrator.shutdownTimeout).toBe(3000);
      expect(config.llm.defaultProvider).toBe("anthropic");
    });

    it("should merge file config with defaults", async () => {
      const configPath = path.join(tempDir, "test-config.json");
      const testConfig = {
        orchestrator: {
          shutdownTimeout: 3000,
        },
      };

      await fs.writeFile(configPath, JSON.stringify(testConfig));

      const config = await loadConfig({ configPath });
      expect(config.orchestrator.shutdownTimeout).toBe(3000);
      expect(config.orchestrator.processSpawnRetries).toBe(3); // default value
      expect(config.llm.defaultProvider).toBe("openai"); // default value
    });

    it("should prioritize environment variables over file config", async () => {
      const configPath = path.join(tempDir, "test-config.json");
      const testConfig = {
        orchestrator: {
          shutdownTimeout: 3000,
        },
      };

      await fs.writeFile(configPath, JSON.stringify(testConfig));
      process.env.PO_SHUTDOWN_TIMEOUT = "5000";

      const config = await loadConfig({ configPath });
      expect(config.orchestrator.shutdownTimeout).toBe(5000);
    });

    it("should handle missing config file gracefully", async () => {
      const configPath = path.join(tempDir, "nonexistent.json");
      const config = await loadConfig({ configPath });
      expect(config.orchestrator.shutdownTimeout).toBe(2000); // default
    });

    it("should validate config by default", async () => {
      const configPath = path.join(tempDir, "invalid-config.json");
      const invalidConfig = {
        orchestrator: {
          shutdownTimeout: -1000, // invalid: must be positive
        },
      };

      await fs.writeFile(configPath, JSON.stringify(invalidConfig));

      await expect(loadConfig({ configPath })).rejects.toThrow(
        "Configuration validation failed"
      );
    });

    it("should skip validation when requested", async () => {
      const configPath = path.join(tempDir, "invalid-config.json");
      const invalidConfig = {
        orchestrator: {
          shutdownTimeout: -1000,
        },
      };

      await fs.writeFile(configPath, JSON.stringify(invalidConfig));

      const config = await loadConfig({ configPath, validate: false });
      expect(config.orchestrator.shutdownTimeout).toBe(-1000);
    });
  });

  describe("Environment Variable Loading", () => {
    it("should load all orchestrator settings from env", () => {
      process.env.PO_SHUTDOWN_TIMEOUT = "3000";
      process.env.PO_PROCESS_SPAWN_RETRIES = "5";
      process.env.PO_LOCK_FILE_TIMEOUT = "10000";
      process.env.PO_WATCH_DEBOUNCE = "200";
      resetConfig();

      const config = getConfig();
      expect(config.orchestrator.shutdownTimeout).toBe(3000);
      expect(config.orchestrator.processSpawnRetries).toBe(5);
      expect(config.orchestrator.lockFileTimeout).toBe(10000);
      expect(config.orchestrator.watchDebounce).toBe(200);
    });

    it("should load all task runner settings from env", () => {
      process.env.PO_MAX_REFINEMENT_ATTEMPTS = "5";
      process.env.PO_STAGE_TIMEOUT = "600000";
      process.env.PO_LLM_REQUEST_TIMEOUT = "120000";
      resetConfig();

      const config = getConfig();
      expect(config.taskRunner.maxRefinementAttempts).toBe(5);
      expect(config.taskRunner.stageTimeout).toBe(600000);
      expect(config.taskRunner.llmRequestTimeout).toBe(120000);
    });

    it("should load all LLM settings from env", () => {
      process.env.PO_DEFAULT_PROVIDER = "anthropic";
      process.env.PO_DEFAULT_MODEL = "claude-3-opus";
      process.env.PO_MAX_CONCURRENCY = "10";
      resetConfig();

      const config = getConfig();
      expect(config.llm.defaultProvider).toBe("anthropic");
      expect(config.llm.defaultModel).toBe("claude-3-opus");
      expect(config.llm.maxConcurrency).toBe(10);
    });

    it("should load UI settings from env", () => {
      process.env.PORT = "4000";
      process.env.PO_UI_HOST = "0.0.0.0";
      process.env.PO_HEARTBEAT_INTERVAL = "60000";
      resetConfig();

      const config = getConfig();
      expect(config.ui.port).toBe(4000);
      expect(config.ui.host).toBe("0.0.0.0");
      expect(config.ui.heartbeatInterval).toBe(60000);
    });

    it("should prefer PO_UI_PORT over PORT", () => {
      process.env.PORT = "4000";
      process.env.PO_UI_PORT = "5000";
      resetConfig();

      const config = getConfig();
      expect(config.ui.port).toBe(5000);
    });

    it("should load path settings from env while ignoring deprecated configDir override", () => {
      process.env.PO_ROOT = "/custom/root";
      process.env.PO_DATA_DIR = "custom-data";
      process.env.PO_CONFIG_DIR = "custom-config";
      resetConfig();

      const config = getConfig();
      expect(config.paths.root).toBe("/custom/root");
      expect(config.paths.dataDir).toBe("custom-data");
      expect(config.paths.configDir).toBeUndefined();
    });

    it("should load logging settings from env", () => {
      process.env.PO_LOG_LEVEL = "debug";
      process.env.PO_LOG_FORMAT = "text";
      process.env.PO_LOG_DESTINATION = "/var/log/pipeline.log";
      resetConfig();

      const config = getConfig();
      expect(config.logging.level).toBe("debug");
      expect(config.logging.format).toBe("text");
      expect(config.logging.destination).toBe("/var/log/pipeline.log");
    });
  });

  describe("Configuration Validation", () => {
    it("should reject negative shutdown timeout", async () => {
      const config = {
        orchestrator: { shutdownTimeout: -100 },
      };

      await expect(
        loadConfig({
          configPath: await writeTestConfig(config),
        })
      ).rejects.toThrow("shutdownTimeout must be positive");
    });

    it("should reject negative process spawn retries", async () => {
      const config = {
        orchestrator: { processSpawnRetries: -1 },
      };

      await expect(
        loadConfig({
          configPath: await writeTestConfig(config),
        })
      ).rejects.toThrow("processSpawnRetries must be non-negative");
    });

    it("should reject negative max refinement attempts", async () => {
      const config = {
        taskRunner: { maxRefinementAttempts: -1 },
      };

      await expect(
        loadConfig({
          configPath: await writeTestConfig(config),
        })
      ).rejects.toThrow("maxRefinementAttempts must be non-negative");
    });

    it("should reject invalid port numbers", async () => {
      const config = {
        ui: { port: 70000 },
      };

      await expect(
        loadConfig({
          configPath: await writeTestConfig(config),
        })
      ).rejects.toThrow("port must be between 1 and 65535");
    });

    it("should reject invalid provider", async () => {
      const config = {
        llm: { defaultProvider: "invalid-provider" },
      };

      await expect(
        loadConfig({
          configPath: await writeTestConfig(config),
        })
      ).rejects.toThrow("defaultProvider must be one of");
    });

    it("should reject invalid log level", async () => {
      const config = {
        logging: { level: "invalid" },
      };

      await expect(
        loadConfig({
          configPath: await writeTestConfig(config),
        })
      ).rejects.toThrow("level must be one of");
    });

    it("should accept valid configuration", async () => {
      const config = {
        orchestrator: { shutdownTimeout: 5000 },
        taskRunner: { maxRefinementAttempts: 3 },
        llm: { defaultProvider: "deepseek", maxConcurrency: 10 },
        ui: { port: 8080 },
        logging: { level: "debug" },
      };

      const loaded = await loadConfig({
        configPath: await writeTestConfig(config),
      });

      expect(loaded.orchestrator.shutdownTimeout).toBe(5000);
      expect(loaded.taskRunner.maxRefinementAttempts).toBe(3);
      expect(loaded.llm.defaultProvider).toBe("deepseek");
      expect(loaded.ui.port).toBe(8080);
      expect(loaded.logging.level).toBe("debug");
    });
  });

  describe("getConfigValue", () => {
    it("should get nested config value by path", () => {
      const value = getConfigValue("orchestrator.shutdownTimeout");
      expect(value).toBe(2000);
    });

    it("should get top-level config value", () => {
      const value = getConfigValue("orchestrator");
      expect(value).toHaveProperty("shutdownTimeout");
    });

    it("should return default value for missing path", () => {
      const value = getConfigValue("nonexistent.path", "default");
      expect(value).toBe("default");
    });

    it("should return undefined for missing path without default", () => {
      const value = getConfigValue("nonexistent.path");
      expect(value).toBeUndefined();
    });

    it("should handle deep nesting", () => {
      const value = getConfigValue("orchestrator.shutdownTimeout");
      expect(value).toBe(2000);
    });
  });

  describe("resetConfig", () => {
    it("should clear cached config", () => {
      const config1 = getConfig();
      resetConfig();
      const config2 = getConfig();
      expect(config1).not.toBe(config2);
    });

    it("should reload config with new environment variables", () => {
      const config1 = getConfig();
      expect(config1.orchestrator.shutdownTimeout).toBe(2000);

      process.env.PO_SHUTDOWN_TIMEOUT = "5000";
      resetConfig();

      const config2 = getConfig();
      expect(config2.orchestrator.shutdownTimeout).toBe(5000);
    });
  });

  // Helper function to write test config
  async function writeTestConfig(config) {
    const configPath = path.join(tempDir, `config-${Date.now()}.json`);
    await fs.writeFile(configPath, JSON.stringify(config));
    return configPath;
  }
});
