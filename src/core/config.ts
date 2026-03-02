import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";

export interface OrchestratorConfig {
  shutdownTimeout: number;
  processSpawnRetries: number;
  processSpawnRetryDelay: number;
  lockFileTimeout: number;
  watchDebounce: number;
  watchStabilityThreshold: number;
  watchPollInterval: number;
}

export interface TaskRunnerConfig {
  maxRefinementAttempts: number;
  stageTimeout: number;
  llmRequestTimeout: number;
}

export interface LLMConfig {
  defaultProvider: string;
  defaultModel: string;
  maxConcurrency: number;
  retryMaxAttempts: number;
  retryBackoffMs: number;
}

export interface UIConfig {
  port: number;
  host: string;
  heartbeatInterval: number;
  maxRecentChanges: number;
}

export interface PathsConfig {
  root: string;
  dataDir: string;
  pendingDir: string;
  currentDir: string;
  completeDir: string;
}

export interface PipelineEntry {
  configDir: string;
  tasksDir: string;
  name?: string;
  description?: string;
}

export interface ValidationConfig {
  seedNameMinLength: number;
  seedNameMaxLength: number;
  seedNamePattern: string;
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  format: "json";
  destination: "stdout";
}

export interface AppConfig {
  orchestrator: OrchestratorConfig;
  taskRunner: TaskRunnerConfig;
  llm: LLMConfig;
  ui: UIConfig;
  paths: PathsConfig;
  pipelines: Record<string, PipelineEntry>;
  validation: ValidationConfig;
  logging: LoggingConfig;
}

export interface LoadConfigOptions {
  configPath?: string;
  validate?: boolean;
}

export interface PipelineConfigResult {
  pipelineJsonPath: string;
  tasksDir: string;
}

export const defaultConfig = {
  orchestrator: {
    shutdownTimeout: 10000,
    processSpawnRetries: 3,
    processSpawnRetryDelay: 1000,
    lockFileTimeout: 30000,
    watchDebounce: 500,
    watchStabilityThreshold: 1000,
    watchPollInterval: 100,
  },
  taskRunner: {
    maxRefinementAttempts: 3,
    stageTimeout: 300000,
    llmRequestTimeout: 120000,
  },
  llm: {
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    maxConcurrency: 5,
    retryMaxAttempts: 3,
    retryBackoffMs: 1000,
  },
  ui: {
    port: 3000,
    host: "localhost",
    heartbeatInterval: 30000,
    maxRecentChanges: 50,
  },
  paths: {
    root: process.cwd(),
    dataDir: "data",
    pendingDir: "data/pending",
    currentDir: "data/current",
    completeDir: "data/complete",
  },
  pipelines: {},
  validation: {
    seedNameMinLength: 3,
    seedNameMaxLength: 64,
    seedNamePattern: "^[a-z0-9-]+$",
  },
  logging: {
    level: "info" as const,
    format: "json" as const,
    destination: "stdout" as const,
  },
} satisfies AppConfig;

// ─── Deep Merge ───────────────────────────────────────────────────────────────

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(target: PlainObject, source: PlainObject): PlainObject {
  const result: PlainObject = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function loadFromEnvironment(config: AppConfig): AppConfig {
  const overrides: PlainObject = {};

  const root = process.env["PO_ROOT"] ? path.resolve(process.env["PO_ROOT"]) : undefined;
  const dataDir = process.env["PO_DATA_DIR"];
  if (root || dataDir) {
    overrides["paths"] = {
      ...(root ? { root } : {}),
      ...(dataDir ? { dataDir } : {}),
    };
  }

  const portRaw = process.env["PORT"];
  const poPortRaw = process.env["PO_UI_PORT"];
  const host = process.env["PO_HOST"];
  const uiOverrides: PlainObject = {};
  if (portRaw) uiOverrides["port"] = parseInt(portRaw, 10);
  if (poPortRaw) uiOverrides["port"] = parseInt(poPortRaw, 10);
  if (host) uiOverrides["host"] = host;
  if (Object.keys(uiOverrides).length > 0) overrides["ui"] = uiOverrides;

  const maxConcurrencyRaw = process.env["PO_MAX_CONCURRENCY"];
  if (maxConcurrencyRaw) {
    overrides["llm"] = { maxConcurrency: parseInt(maxConcurrencyRaw, 10) };
  }

  const shutdownTimeoutRaw = process.env["PO_SHUTDOWN_TIMEOUT"];
  if (shutdownTimeoutRaw) {
    overrides["orchestrator"] = { shutdownTimeout: parseInt(shutdownTimeoutRaw, 10) };
  }

  const logLevel = process.env["PO_LOG_LEVEL"];
  if (logLevel && (VALID_LOG_LEVELS as readonly string[]).includes(logLevel)) {
    overrides["logging"] = { level: logLevel };
  }

  return deepMerge(config as unknown as PlainObject, overrides) as unknown as AppConfig;
}

async function loadFromFile(filePath: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to load config file: ${filePath}`);
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to load config file: ${filePath}: ${String(err)}`);
  }
}

function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  if (config.ui.port < 1 || config.ui.port > 65535) {
    errors.push(`ui.port must be between 1 and 65535, got ${config.ui.port}`);
  }
  if (config.llm.maxConcurrency < 1) {
    errors.push(`llm.maxConcurrency must be >= 1, got ${config.llm.maxConcurrency}`);
  }
  if (config.taskRunner.maxRefinementAttempts < 1) {
    errors.push(`taskRunner.maxRefinementAttempts must be >= 1, got ${config.taskRunner.maxRefinementAttempts}`);
  }
  if (!(VALID_LOG_LEVELS as readonly string[]).includes(config.logging.level)) {
    errors.push(`logging.level must be one of ${VALID_LOG_LEVELS.join(", ")}, got ${config.logging.level}`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed: ${errors.join("; ")}`);
  }
}

// ─── Module State ─────────────────────────────────────────────────────────────

let cachedConfig: AppConfig | null = null;

// ─── Registry Hydration ───────────────────────────────────────────────────────

interface RegistryPipelines {
  pipelines: Record<string, { configDir?: string; tasksDir?: string }>;
}

interface LegacyRegistry {
  slugs: string[];
}

async function hydratePipelinesFromRegistry(config: AppConfig, registryPath: string): Promise<void> {
  let raw: RegistryPipelines | LegacyRegistry;
  try {
    raw = JSON.parse(await readFile(registryPath, "utf8")) as RegistryPipelines | LegacyRegistry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw new Error(`Failed to read pipeline registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  if ("slugs" in raw) {
    console.warn(`[config] Legacy registry format detected at ${registryPath} — skipping`);
    return;
  }

  const root = config.paths.root;
  for (const [slug, entry] of Object.entries(raw.pipelines)) {
    const resolvedConfigDir = entry.configDir
      ? (path.isAbsolute(entry.configDir) ? entry.configDir : path.join(root, entry.configDir))
      : path.join(root, "pipeline-config", slug);
    const resolvedTasksDir = entry.tasksDir
      ? (path.isAbsolute(entry.tasksDir) ? entry.tasksDir : path.join(root, entry.tasksDir))
      : path.join(resolvedConfigDir, "tasks");
    config.pipelines[slug] = {
      configDir: resolvedConfigDir,
      tasksDir: resolvedTasksDir,
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function resetConfig(): void {
  cachedConfig = null;
}

export async function loadConfig(options?: LoadConfigOptions): Promise<AppConfig> {
  let config = JSON.parse(JSON.stringify(defaultConfig)) as AppConfig;

  if (options?.configPath) {
    const fileData = await loadFromFile(options.configPath);
    if (fileData) {
      config = deepMerge(config as unknown as PlainObject, fileData) as unknown as AppConfig;
    }
  }

  config = loadFromEnvironment(config);

  if (!process.env["PO_ROOT"]) {
    throw new Error("PO_ROOT is required");
  }

  await hydratePipelinesFromRegistry(config, path.join(config.paths.root, "pipeline-config", "registry.json"));

  if (Object.keys(config.pipelines).length === 0) {
    throw new Error("No pipelines are registered");
  } else {
    const errors: string[] = [];
    for (const [slug, entry] of Object.entries(config.pipelines)) {
      const configDirExists = existsSync(path.join(entry.configDir, "pipeline.json"));
      const tasksDirExists = await stat(entry.tasksDir).then(() => true).catch(() => false);
      if (!configDirExists) {
        errors.push(`Pipeline '${slug}': pipeline.json not found`);
      }
      if (!tasksDirExists) {
        errors.push(`Pipeline '${slug}': tasksDir not found`);
      }
    }
    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }
  }

  if (options?.validate !== false) {
    validateConfig(config);
  }

  cachedConfig = config;
  return config;
}

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  let config = JSON.parse(JSON.stringify(defaultConfig)) as AppConfig;
  config = loadFromEnvironment(config);

  const rawPoRoot = process.env["PO_ROOT"];
  if (!rawPoRoot) {
    if (process.env["NODE_ENV"] === "test") {
      cachedConfig = config;
      return cachedConfig;
    }
    throw new Error("PO_ROOT is required");
  }
  const poRoot = path.resolve(rawPoRoot);

  const registryPath = path.join(poRoot, "pipeline-config", "registry.json");
  if (existsSync(registryPath)) {
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as RegistryPipelines | LegacyRegistry;
    if (!("slugs" in raw)) {
      for (const [slug, entry] of Object.entries(raw.pipelines)) {
        const resolvedConfigDir = entry.configDir
          ? (path.isAbsolute(entry.configDir) ? entry.configDir : path.join(poRoot, entry.configDir))
          : path.join(poRoot, "pipeline-config", slug);
        const resolvedTasksDir = entry.tasksDir
          ? (path.isAbsolute(entry.tasksDir) ? entry.tasksDir : path.join(poRoot, entry.tasksDir))
          : path.join(resolvedConfigDir, "tasks");
        config.pipelines[slug] = {
          configDir: resolvedConfigDir,
          tasksDir: resolvedTasksDir,
        };
      }
    }
  }

  if (Object.keys(config.pipelines).length === 0 && process.env["NODE_ENV"] !== "test") {
    console.warn("[config] No pipelines found in registry");
  }

  cachedConfig = config;
  return cachedConfig;
}

export function getConfigValue(dotPath: string, defaultValue?: unknown): unknown {
  const config = getConfig();
  const parts = dotPath.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return defaultValue;
    current = (current as Record<string, unknown>)[part];
  }
  return current === undefined ? defaultValue : current;
}

export function getPipelineConfig(slug: string, root?: string): PipelineConfigResult {
  if (root) {
    const registryPath = path.join(root, "pipeline-config", "registry.json");
    if (existsSync(registryPath)) {
      const raw = JSON.parse(readFileSync(registryPath, "utf8")) as RegistryPipelines | LegacyRegistry;
      if (!("slugs" in raw)) {
        const entry = raw.pipelines[slug];
        if (!entry) {
          throw new Error(`Pipeline '${slug}' not found in registry`);
        }
        const resolvedConfigDir = entry.configDir
          ? (path.isAbsolute(entry.configDir) ? entry.configDir : path.join(root, entry.configDir))
          : path.join(root, "pipeline-config", slug);
        const resolvedTasksDir = entry.tasksDir
          ? (path.isAbsolute(entry.tasksDir) ? entry.tasksDir : path.join(root, entry.tasksDir))
          : path.join(resolvedConfigDir, "tasks");
        return {
          pipelineJsonPath: path.join(resolvedConfigDir, "pipeline.json"),
          tasksDir: resolvedTasksDir,
        };
      }
    }
    throw new Error(`Pipeline '${slug}' not found in registry`);
  }

  const config = getConfig();
  const entry = config.pipelines[slug];
  if (!entry) {
    throw new Error(`Pipeline '${slug}' not found in registry`);
  }
  return {
    pipelineJsonPath: path.join(entry.configDir, "pipeline.json"),
    tasksDir: entry.tasksDir,
  };
}
