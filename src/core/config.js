/**
 * Get pipeline configuration by slug
 *
 * @param {string} slug - Pipeline slug identifier
 * @returns {Object} Object with pipelineJsonPath and tasksDir
 */
export function getPipelineConfig(slug) {
  const config = getConfig();

  if (!config.pipelines || !config.pipelines[slug]) {
    throw new Error('Pipeline ' + slug + ' not found in registry');
  }

  const pipeline = config.pipelines[slug];
  const path = require('path');

  return {
    pipelineJsonPath: path.join(pipeline.configDir, 'pipeline.json'),
    tasksDir: pipeline.tasksDir,
  };
}

/**
 * Get all available pipeline configurations
 *
 * @returns {Object} Object mapping slugs to pipeline configurations
 */
export function getAllPipelineConfigs() {
  const config = getConfig();
  const { pipelines } = config;

  if (!pipelines || !pipelines.registry) {
    return {};
  }

  const result = {};
  const root = config.paths.root;

  for (const [slug, pipelineConfig] of Object.entries(pipelines.registry)) {
    // Validate required keys
    if (!pipelineConfig.configDir || !pipelineConfig.tasksDir) {
      console.warn(
        `Skipping pipeline entry '${slug}': missing required key(s) ` +
        `${!pipelineConfig.configDir ? "'configDir' " : ""}` +
        `${!pipelineConfig.tasksDir ? "'tasksDir' " : ""}`.trim()
      );
      continue; // Skip invalid entries
    }

    result[slug] = {
      ...pipelineConfig,
      slug,
      tasksDir: path.resolve(root, pipelineConfig.tasksDir),
      pipelinePath: path.resolve(
        root,
        pipelineConfig.configDir,
        "pipeline.json"
      ),
      taskRegistryPath: path.resolve(root, pipelineConfig.tasksDir, "index.js"),
    };
  }

  return result;
}

/**
 * Get the default pipeline configuration
 *
 * @returns {Object|null} Default pipeline configuration or null if not found
 */
export function getDefaultPipelineConfig() {
  const config = getConfig();
  const { pipelines } = config;

  if (!pipelines || !pipelines.defaultSlug) {
    return null;
  }

  // Validate that defaultSlug exists in pipelines.registry
  if (!pipelines.registry || !(pipelines.defaultSlug in pipelines.registry)) {
    throw new Error(
      `Default pipeline slug "${pipelines.defaultSlug}" does not exist in pipelines.registry.`
    );
  }
  return getPipelineConfig(pipelines.defaultSlug).config;
}
