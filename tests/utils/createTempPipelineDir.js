import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Creates a temporary pipeline directory structure for testing
 * @returns {Promise<string>} Path to the temporary pipeline root directory
 */
export async function createTempPipelineDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-test-"));

  // Create the pipeline data directory structure
  const pipelineDataDir = path.join(tempDir, "pipeline-data");
  await fs.mkdir(path.join(pipelineDataDir, "pending"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "current"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "complete"), { recursive: true });

  return pipelineDataDir;
}

export async function createTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-test-"));

  // Create the pipeline data directory structure
  const pipelineDataDir = path.join(tempDir, "pipeline-data");
  await fs.mkdir(path.join(pipelineDataDir, "pending"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "current"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "complete"), { recursive: true });

  return tempDir;
}

/**
 * Creates multiple pipeline configurations for testing slug-based resolution
 * @param {string} baseDir - Base directory for pipeline configurations
 * @param {Object[]} pipelines - Array of pipeline configurations
 * @returns {Promise<Object>} Object containing pipeline registry and configurations
 */
export async function createMultiPipelineConfig(baseDir, pipelines = []) {
  const pipelineConfigDir = path.join(baseDir, "pipeline-config");
  await fs.mkdir(pipelineConfigDir, { recursive: true });

  // Default pipelines if none provided
  const defaultPipelines = [
    {
      slug: "test-pipeline",
      name: "Test Pipeline",
      description: "Test pipeline for testing",
      tasks: ["noop"],
      taskConfig: {
        noop: {
          model: "test-model",
          temperature: 0.7,
          maxTokens: 1000,
        },
      },
    },
    {
      slug: "content-generation",
      name: "Content Generation Pipeline",
      description: "Pipeline for generating content",
      tasks: ["analysis", "synthesis"],
      taskConfig: {
        analysis: {
          model: "analysis-model",
          temperature: 0.5,
        },
        synthesis: {
          model: "synthesis-model",
          temperature: 0.8,
        },
      },
    },
  ];

  const pipelineDefs = pipelines.length > 0 ? pipelines : defaultPipelines;
  const registry = {
    defaultSlug: pipelineDefs[0].slug,
    pipelines: {},
  };

  // Create pipeline directories and configurations
  for (const pipelineDef of pipelineDefs) {
    const pipelineDir = path.join(pipelineConfigDir, pipelineDef.slug);
    const tasksDir = path.join(pipelineDir, "tasks");

    await fs.mkdir(tasksDir, { recursive: true });

    // Create pipeline.json
    const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
    await fs.writeFile(
      pipelineJsonPath,
      JSON.stringify(
        {
          name: pipelineDef.slug,
          version: "1.0.0",
          tasks: pipelineDef.tasks,
          taskConfig: pipelineDef.taskConfig,
        },
        null,
        2
      ),
      "utf8"
    );

    // Create tasks/index.js
    const taskRegistry = {};
    for (const taskName of pipelineDef.tasks) {
      // Create task file
      const taskPath = path.join(baseDir, "pipeline-tasks", `${taskName}.js`);
      await fs.mkdir(path.dirname(taskPath), { recursive: true });

      await fs.writeFile(
        taskPath,
        `export default {
  ingestion: (ctx) => ({ ...ctx, data: "${taskName}-data" }),
  preProcessing: (ctx) => ({ ...ctx, processed: true }),
  promptTemplating: (ctx) => ({ ...ctx, prompt: "${taskName} prompt" }),
  inference: (ctx) => ({ ...ctx, response: "${taskName} response" }),
  parsing: (ctx) => ({ ...ctx, parsed: { task: "${taskName}", result: true } }),
  validateStructure: (ctx) => ({ ...ctx, validationPassed: true }),
  validateQuality: (ctx) => ({ ...ctx, qualityPassed: true }),
  finalValidation: (ctx) => ({ ...ctx, output: { task: "${taskName}", success: true } })
};`,
        "utf8"
      );

      taskRegistry[taskName] = taskPath;
    }

    await fs.writeFile(
      path.join(tasksDir, "index.js"),
      `export default ${JSON.stringify(taskRegistry, null, 2)};`,
      "utf8"
    );

    // Add to registry
    registry.pipelines[pipelineDef.slug] = {
      name: pipelineDef.name,
      description: pipelineDef.description,
      pipelineJsonPath,
      tasksDir,
    };
  }

  // Write registry.json
  await fs.writeFile(
    path.join(pipelineConfigDir, "registry.json"),
    JSON.stringify(registry, null, 2),
    "utf8"
  );

  return {
    registry,
    pipelineConfigDir,
    pipelines: pipelineDefs,
  };
}

/**
 * Creates a complete test environment with multiple pipelines
 * @param {Object[]} pipelines - Optional pipeline configurations
 * @returns {Promise<Object>} Test environment details
 */
export async function createMultiPipelineTestEnv(pipelines = []) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "multi-pipeline-test-")
  );

  // Create pipeline data structure
  const pipelineDataDir = path.join(tempDir, "pipeline-data");
  await fs.mkdir(path.join(pipelineDataDir, "pending"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "current"), { recursive: true });
  await fs.mkdir(path.join(pipelineDataDir, "complete"), { recursive: true });

  // Create multi-pipeline configuration
  const config = await createMultiPipelineConfig(tempDir, pipelines);

  return {
    tempDir,
    pipelineDataDir,
    ...config,
  };
}
