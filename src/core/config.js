/**
 * Centralized configuration management for Prompt Orchestration Pipeline
 *
 * This module provides a single source of truth for all configuration values,
 * supporting both environment variables and config file overrides.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Default configuration values
 * These can be overridden by environment variables or config file
 */
export const defaultConfig = {
  orchestrator: {
    shutdownTimeout: 2000,
    processSpawnRetries: 3,
    lockFileTimeout: 5000,
    watchDebounce: 100,
    watchStabilityThreshold: 200,
    watchPollInterval: 50,
  },
  taskRunner: {
    maxRefinementAttempts: 2,
    stageTimeout: 300000,
    llmRequestTimeout: 60000,
  },
  llm: {
    defaultProvider: "openai",
    defaultModel: "gpt-5-chat-latest",
    maxConcurrency: 5,
    retryMaxAttempts: 3,
    retryBackoffMs: 1000,
  },
  ui: {
    port: 3000,
    host: "localhost",
    heartbeatInterval: 30000,
    maxRecentChanges: 10,
  },
  paths: {
    root: process.env.PO_ROOT || process.cwd(),
    dataDir: "pipeline-data",
    configDir: "pipeline-config",
    pendingDir: "pending",
    currentDir: "current",
    completeDir: "complete",
  },
  validation: {
    seedNameMinLength: 1,
    seedNameMaxLength: 100,
    seedNamePattern: "^[a-zA-Z0-9-_]+$",
  },
  logging: {
    level: "info",
    format: "json",
    destination: "stdout",
  },
};

/**
 * Current loaded configuration
 * Initialized with defaults, then overridden by environment and config file
 */
let currentConfig = null;

/**
 * Load configuration from environment variables
 * Environment variables take precedence over defaults
 */
function loadFromEnvironment(config) {
  const envConfig = { ...config };

  // Orchestrator settings
  if (process.env.PO_SHUTDOWN_TIMEOUT) {
    envConfig.orchestrator.shutdownTimeout = parseInt(
      process.env.PO_SHUTDOWN_TIMEOUT,
      10
    );
  }
  if (process.env.PO_PROCESS_SPAWN_RETRIES) {
    envConfig.orchestrator.processSpawnRetries = parseInt(
      process.env.PO_PROCESS_SPAWN_RETRIES,
      10
    );
  }
  if (process.env.PO_LOCK_FILE_TIMEOUT) {
    envConfig.orchestrator.lockFileTimeout = parseInt(
      process.env.PO_LOCK_FILE_TIMEOUT,
      10
    );
  }
  if (process.env.PO_WATCH_DEBOUNCE) {
    envConfig.orchestrator.watchDebounce = parseInt(
      process.env.PO_WATCH_DEBOUNCE,
      10
    );
  }

  // Task runner settings
  if (process.env.PO_MAX_REFINEMENT_ATTEMPTS) {
    envConfig.taskRunner.maxRefinementAttempts = parseInt(
      process.env.PO_MAX_REFINEMENT_ATTEMPTS,
      10
    );
  }
  if (process.env.PO_STAGE_TIMEOUT) {
    envConfig.taskRunner.stageTimeout = parseInt(
      process.env.PO_STAGE_TIMEOUT,
      10
    );
  }
  if (process.env.PO_LLM_REQUEST_TIMEOUT) {
    envConfig.taskRunner.llmRequestTimeout = parseInt(
      process.env.PO_LLM_REQUEST_TIMEOUT,
      10
    );
  }

  // LLM settings
  if (process.env.PO_DEFAULT_PROVIDER) {
    envConfig.llm.defaultProvider = process.env.PO_DEFAULT_PROVIDER;
  }
  if (process.env.PO_DEFAULT_MODEL) {
    envConfig.llm.defaultModel = process.env.PO_DEFAULT_MODEL;
  }
  if (process.env.PO_MAX_CONCURRENCY) {
    envConfig.llm.maxConcurrency = parseInt(process.env.PO_MAX_CONCURRENCY, 10);
  }

  // UI settings
  if (process.env.PO_UI_PORT || process.env.PORT) {
    envConfig.ui.port = parseInt(
      process.env.PO_UI_PORT || process.env.PORT,
      10
    );
  }
  if (process.env.PO_UI_HOST) {
    envConfig.ui.host = process.env.PO_UI_HOST;
  }
  if (process.env.PO_HEARTBEAT_INTERVAL) {
    envConfig.ui.heartbeatInterval = parseInt(
      process.env.PO_HEARTBEAT_INTERVAL,
      10
    );
  }

  // Path settings
  if (process.env.PO_ROOT) {
    envConfig.paths.root = process.env.PO_ROOT;
  }
  if (process.env.PO_DATA_DIR) {
    envConfig.paths.dataDir = process.env.PO_DATA_DIR;
  }
  if (process.env.PO_CONFIG_DIR) {
    envConfig.paths.configDir = process.env.PO_CONFIG_DIR;
  }

  // Logging settings
  if (process.env.PO_LOG_LEVEL) {
    envConfig.logging.level = process.env.PO_LOG_LEVEL;
  }
  if (process.env.PO_LOG_FORMAT) {
    envConfig.logging.format = process.env.PO_LOG_FORMAT;
  }
  if (process.env.PO_LOG_DESTINATION) {
    envConfig.logging.destination = process.env.PO_LOG_DESTINATION;
  }

  return envConfig;
}

/**
 * Deep merge two configuration objects
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Load configuration from a JSON file
 * Returns null if file doesn't exist
 */
async function loadFromFile(configPath) {
  try {
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(
      `Failed to load config file ${configPath}: ${error.message}`
    );
  }
}

/**
 * Validate configuration values
 * Throws if configuration is invalid
 */
function validateConfig(config) {
  const errors = [];

  // Validate numeric values are positive
  if (config.orchestrator.shutdownTimeout <= 0) {
    errors.push("orchestrator.shutdownTimeout must be positive");
  }
  if (config.orchestrator.processSpawnRetries < 0) {
    errors.push("orchestrator.processSpawnRetries must be non-negative");
  }
  if (config.taskRunner.maxRefinementAttempts < 0) {
    errors.push("taskRunner.maxRefinementAttempts must be non-negative");
  }
  if (config.llm.maxConcurrency <= 0) {
    errors.push("llm.maxConcurrency must be positive");
  }
  if (config.ui.port < 1 || config.ui.port > 65535) {
    errors.push("ui.port must be between 1 and 65535");
  }

  // Validate provider
  const validProviders = ["openai", "deepseek", "anthropic"];
  if (!validProviders.includes(config.llm.defaultProvider)) {
    errors.push(
      `llm.defaultProvider must be one of: ${validProviders.join(", ")}`
    );
  }

  // Validate log level
  const validLogLevels = ["debug", "info", "warn", "error"];
  if (!validLogLevels.includes(config.logging.level)) {
    errors.push(`logging.level must be one of: ${validLogLevels.join(", ")}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}

/**
 * Initialize and load configuration
 *
 * Priority order (highest to lowest):
 * 1. Environment variables
 * 2. Config file (if provided)
 * 3. Default values
 *
 * @param {Object} options - Configuration options
 * @param {string} options.configPath - Path to config file (optional)
 * @param {boolean} options.validate - Whether to validate config (default: true)
 * @returns {Object} Loaded configuration
 */
export async function loadConfig(options = {}) {
  const { configPath, validate = true } = options;

  // Start with defaults
  let config = JSON.parse(JSON.stringify(defaultConfig));

  // Load from config file if provided
  if (configPath) {
    const fileConfig = await loadFromFile(configPath);
    if (fileConfig) {
      config = deepMerge(config, fileConfig);
    }
  }

  // Override with environment variables
  config = loadFromEnvironment(config);

  // Validate if requested
  if (validate) {
    validateConfig(config);
  }

  // Cache the loaded config
  currentConfig = config;

  return config;
}

/**
 * Get the current configuration
 * Loads default config if not already loaded
 *
 * @returns {Object} Current configuration
 */
export function getConfig() {
  if (!currentConfig) {
    // Load defaults synchronously for first access
    currentConfig = loadFromEnvironment(
      JSON.parse(JSON.stringify(defaultConfig))
    );
  }
  return currentConfig;
}

/**
 * Reset configuration to defaults
 * Useful for testing
 */
export function resetConfig() {
  currentConfig = null;
}

/**
 * Get a specific configuration value by path
 *
 * @param {string} path - Dot-separated path (e.g., "orchestrator.shutdownTimeout")
 * @param {*} defaultValue - Default value if path not found
 * @returns {*} Configuration value
 */
export function getConfigValue(path, defaultValue = undefined) {
  const config = getConfig();
  const parts = path.split(".");
  let value = config;

  for (const part of parts) {
    if (value && typeof value === "object" && part in value) {
      value = value[part];
    } else {
      return defaultValue;
    }
  }

  return value;
}
