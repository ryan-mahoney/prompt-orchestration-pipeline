import { Orchestrator } from "../core/orchestrator.js";
import path from "node:path";
import fs from "node:fs/promises";

// Pure functional utilities
const createPaths = (config) => {
  const {
    rootDir,
    dataDir = "pipeline-data",
    configDir = "pipeline-config",
  } = config;
  return {
    pending: path.join(rootDir, dataDir, "pending"),
    current: path.join(rootDir, dataDir, "current"),
    complete: path.join(rootDir, dataDir, "complete"),
    pipeline: path.join(rootDir, configDir, "pipeline.json"),
    tasks: path.join(rootDir, configDir, "tasks"),
  };
};

const validateConfig = (options = {}) => ({
  rootDir: options.rootDir || process.cwd(),
  dataDir: options.dataDir || "pipeline-data",
  configDir: options.configDir || "pipeline-config",
  autoStart: options.autoStart ?? true,
  ui: options.ui ?? false,
  uiPort: options.uiPort || 3000,
  ...options,
});

const ensureDirectories = async (paths) => {
  for (const dir of Object.values(paths)) {
    if (dir.endsWith(".json")) continue;
    await fs.mkdir(dir, { recursive: true });
  }
};

const loadPipelineDefinition = async (pipelinePath) => {
  try {
    const content = await fs.readFile(pipelinePath, "utf8");
    const definition = JSON.parse(content);
    definition.__path = pipelinePath;
    return definition;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Pipeline definition not found at ${pipelinePath}`);
    }
    throw error;
  }
};

const createOrchestrator = (paths, pipelineDefinition) =>
  new Orchestrator({ paths, pipelineDefinition });

// Main API functions
export const createPipelineOrchestrator = async (options = {}) => {
  const config = validateConfig(options);
  const paths = createPaths(config);

  await ensureDirectories(paths);
  const pipelineDefinition = await loadPipelineDefinition(paths.pipeline);
  const orchestrator = createOrchestrator(paths, pipelineDefinition);

  let uiServer = null;

  const state = {
    config,
    paths,
    pipelineDefinition,
    orchestrator,
    uiServer,
  };

  // Auto-start if configured
  if (config.autoStart) {
    await orchestrator.start();
  }

  // Start UI if configured
  if (config.ui) {
    const { createUIServer } = await import("../ui/server.js");

    // Create API object with state injection for UI server
    const uiApi = {
      submitJob: (seed) => submitJob(state, seed),
      getStatus: (jobName) => getStatus(state, jobName),
      listJobs: (status) => listJobs(state, status),
    };

    uiServer = createUIServer(uiApi);
    uiServer.listen(config.uiPort, () => {
      console.log(`Pipeline UI available at http://localhost:${config.uiPort}`);
    });
    state.uiServer = uiServer;
  }

  return state;
};

// Job management functions
export const submitJob = async (state, seed) => {
  const name = seed.name || `job-${Date.now()}`;
  const seedPath = path.join(state.paths.pending, `${name}-seed.json`);
  await fs.writeFile(seedPath, JSON.stringify(seed, null, 2));
  return { name, seedPath };
};

export const getStatus = async (state, jobName) => {
  try {
    const statusPath = path.join(
      state.paths.current,
      jobName,
      "tasks-status.json"
    );
    return JSON.parse(await fs.readFile(statusPath, "utf8"));
  } catch {}
  try {
    const statusPath = path.join(
      state.paths.complete,
      jobName,
      "tasks-status.json"
    );
    return JSON.parse(await fs.readFile(statusPath, "utf8"));
  } catch {}
  return null;
};

export const listJobs = async (state, status = "all") => {
  const jobs = [];

  const listDirectory = async (dir, suffix = "") => {
    try {
      const entries = await fs.readdir(dir);
      if (suffix) {
        return entries
          .filter((e) => e.endsWith(suffix))
          .map((e) => e.replace(suffix, ""));
      }
      return entries;
    } catch {
      return [];
    }
  };

  if (status === "all" || status === "pending") {
    const pending = await listDirectory(state.paths.pending, "-seed.json");
    jobs.push(...pending.map((name) => ({ name, status: "pending" })));
  }

  if (status === "all" || status === "current") {
    const current = await listDirectory(state.paths.current);
    jobs.push(...current.map((name) => ({ name, status: "current" })));
  }

  if (status === "all" || status === "complete") {
    const complete = await listDirectory(state.paths.complete);
    jobs.push(...complete.map((name) => ({ name, status: "complete" })));
  }

  return jobs;
};

// Control functions
export const start = async (state) => {
  await state.orchestrator.start();
  return state;
};

export const stop = async (state) => {
  if (state.uiServer) {
    await new Promise((resolve) => state.uiServer.close(resolve));
  }
  await state.orchestrator.stop();
  return state;
};

// Backward compatibility - class-like API for easy migration
export const PipelineOrchestrator = {
  async create(options = {}) {
    const state = await createPipelineOrchestrator(options);

    // Return an object with methods that maintain the original API
    return {
      config: state.config,
      paths: state.paths,

      async start() {
        await start(state);
        return this;
      },

      async stop() {
        await stop(state);
        return this;
      },

      async submitJob(seed) {
        return submitJob(state, seed);
      },

      async getStatus(jobName) {
        return getStatus(state, jobName);
      },

      async listJobs(status = "all") {
        return listJobs(state, status);
      },
    };
  },
};

// Export the original functions for direct functional usage
export { runPipeline } from "../core/task-runner.js";
export { selectModel } from "../core/task-runner.js";

export default PipelineOrchestrator;
