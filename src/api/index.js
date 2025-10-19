import { startOrchestrator } from "../core/orchestrator.js";
import path from "node:path";
import fs from "node:fs/promises";
import { validateSeedOrThrow } from "../core/validation.js";
import { validateSeed } from "./validators/seed.js";
import { atomicWrite, cleanupOnFailure } from "./files.js";
import { getDefaultPipelineConfig } from "../core/config.js";
import {
  getPendingSeedPath,
  resolvePipelinePaths,
  getJobDirectoryPath,
  getJobMetadataPath,
  getJobPipelinePath,
} from "../config/paths.js";
import { generateJobId } from "../utils/id-generator.js";

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

const createOrchestrator = (paths, pipelineDefinition, rootDir) =>
  // Accept an explicit rootDir (project root) to avoid passing a subpath.
  // If not provided, fall back to the (possibly-misused) pending path for backward-compat.
  startOrchestrator({ dataDir: rootDir || paths.pending });

// Main API functions
export const createPipelineOrchestrator = async (options = {}) => {
  const config = validateConfig(options);
  const paths = createPaths(config);

  await ensureDirectories(paths);
  const pipelineDefinition = await loadPipelineDefinition(paths.pipeline);
  // Pass config.rootDir as the orchestrator dataDir root so the orchestrator resolves
  // pipeline-data/... correctly (avoids duplicate path segments).
  const orchestrator = await createOrchestrator(
    paths,
    pipelineDefinition,
    config.rootDir
  );

  let uiServer = null;

  const state = {
    config,
    paths,
    pipelineDefinition,
    orchestrator,
    uiServer,
  };

  // Auto-start if configured (startOrchestrator handles this automatically)
  // No need to call orchestrator.start() as startOrchestrator auto-starts when autoStart=true

  // Start UI if configured
  if (config.ui) {
    const { startServer } = await import("../ui/server.js");

    uiServer = await startServer({
      dataDir: config.rootDir,
      port: config.uiPort,
    });

    state.uiServer = uiServer;
    console.log(`Pipeline UI available at ${uiServer.url}`);
  }

  return state;
};

// Job management functions
export const submitJob = async (state, seed) => {
  throw new Error(
    "submitJob is deprecated. Use submitJobWithValidation instead for ID-only job submission."
  );
};

/**
 * Submit a job with comprehensive validation and atomic writes
 * @param {Object} options - Options object
 * @param {string} options.dataDir - Base data directory
 * @param {Object} options.seedObject - Seed object to submit
 * @returns {Promise<Object>} Result object with success status
 */
export const submitJobWithValidation = async ({ dataDir, seedObject }) => {
  let partialFiles = [];

  try {
    // Validate the seed object
    const validatedSeed = await validateSeed(
      JSON.stringify(seedObject),
      dataDir
    );

    // Generate a random job ID
    const jobId = generateJobId();

    // Get the paths
    const paths = resolvePipelinePaths(dataDir);
    const pendingPath = getPendingSeedPath(dataDir, jobId);
    const currentJobDir = getJobDirectoryPath(dataDir, jobId, "current");
    const jobMetadataPath = getJobMetadataPath(dataDir, jobId, "current");
    const jobPipelinePath = getJobPipelinePath(dataDir, jobId, "current");

    // Ensure directories exist
    await fs.mkdir(paths.pending, { recursive: true });
    await fs.mkdir(currentJobDir, { recursive: true });

    // Create job metadata
    const jobMetadata = {
      id: jobId,
      name: validatedSeed.name,
      pipelineName: validatedSeed.pipeline || "default",
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    // Read pipeline configuration for snapshot
    let pipelineSnapshot = null;
    try {
      // Use the default pipeline configuration from registry
      const defaultPipelineConfig = getDefaultPipelineConfig();
      if (!defaultPipelineConfig) {
        throw new Error("No default pipeline configuration found");
      }

      const pipelineContent = await fs.readFile(
        defaultPipelineConfig.pipelinePath,
        "utf8"
      );
      pipelineSnapshot = JSON.parse(pipelineContent);
    } catch (error) {
      // If pipeline config doesn't exist, create a minimal snapshot
      pipelineSnapshot = {
        tasks: [],
        name: validatedSeed.pipeline || "default",
      };
    }

    // Write files atomically
    partialFiles.push(pendingPath);
    await atomicWrite(pendingPath, JSON.stringify(validatedSeed, null, 2));

    partialFiles.push(jobMetadataPath);
    await atomicWrite(jobMetadataPath, JSON.stringify(jobMetadata, null, 2));

    partialFiles.push(jobPipelinePath);
    await atomicWrite(
      jobPipelinePath,
      JSON.stringify(pipelineSnapshot, null, 2)
    );

    return {
      success: true,
      jobId,
      jobName: validatedSeed.name,
      message: "Seed file uploaded successfully",
    };
  } catch (error) {
    // Clean up any partial files on failure
    for (const filePath of partialFiles) {
      try {
        await cleanupOnFailure(filePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    // Map validation errors to appropriate error messages
    let errorMessage = error.message;
    if (error.message.includes("Invalid JSON")) {
      errorMessage = "Invalid JSON";
    } else if (error.message.includes("required")) {
      errorMessage = "Required fields missing";
    }

    return {
      success: false,
      message: errorMessage,
    };
  }
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
  // startOrchestrator already starts automatically, no need to call start
  return state;
};

export const stop = async (state) => {
  if (state.uiServer) {
    await state.uiServer.close();
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
