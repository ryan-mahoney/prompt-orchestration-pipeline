/**
 * Create pipeline endpoint (logic-only)
 *
 * Exports:
 *  - handleCreatePipelineRequest() -> HTTP response wrapper
 *
 * This function creates a new pipeline type by:
 *  - Generating a slug from the provided name
 *  - Ensuring slug uniqueness in the registry
 *  - Creating directory structure and starter files
 *  - Updating the pipeline registry atomically
 */

import { getConfig } from "../../core/config.js";
import { sendJson } from "../utils/http-utils.js";
import * as configBridge from "../config-bridge.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Generate kebab-case slug from pipeline name
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

/**
 * Ensure slug is unique in the registry
 * Appends suffix if needed (e.g., my-pipeline-1, my-pipeline-2)
 */
function ensureUniqueSlug(baseSlug, existingSlugs) {
  let slug = baseSlug;
  let suffix = 1;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  return slug;
}

/**
 * Create starter files for a new pipeline
 */
async function createStarterFiles(pipelineDir, name, description) {
  // Create tasks directory
  const tasksDir = path.join(pipelineDir, "tasks");
  await fs.mkdir(tasksDir, { recursive: true });

  // Create pipeline.json
  const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
  const pipelineJsonContent = JSON.stringify(
    {
      name,
      description,
      stages: [],
      defaultTaskConfig: {},
    },
    null,
    2
  );
  await fs.writeFile(pipelineJsonPath, pipelineJsonContent, "utf8");

  // Create tasks/index.js
  const tasksIndexPath = path.join(tasksDir, "index.js");
  const tasksIndexContent = `// Task registry for ${name}\n// Add task definitions here following the pattern in demo/pipeline-config/content-generation/tasks/\nexport const tasks = {};\n`;
  await fs.writeFile(tasksIndexPath, tasksIndexContent, "utf8");
}

/**
 * Handle pipeline creation request
 *
 * Behavior:
 *  - Validate name and description are present
 *  - Generate slug from name (kebab-case)
 *  - Ensure slug uniqueness in registry
 *  - Create directory structure and starter files
 *  - Update registry.json atomically
 *  - Return created pipeline data on success
 */
export async function handleCreatePipelineRequest(name, description) {
  console.log("[CreatePipelineEndpoint] Request to create pipeline:", name);

  // Validate required fields
  if (!name || typeof name !== "string" || name.trim() === "") {
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.VALIDATION_ERROR,
      "Missing required field: name"
    );
  }

  if (
    !description ||
    typeof description !== "string" ||
    description.trim() === ""
  ) {
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.VALIDATION_ERROR,
      "Missing required field: description"
    );
  }

  // Get configuration
  const config = getConfig();
  const rootDir = config.paths?.root;

  if (!rootDir) {
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.BAD_REQUEST,
      "PO_ROOT not configured"
    );
  }

  const pipelineConfigDir = path.join(rootDir, "pipeline-config");
  const registryPath = path.join(pipelineConfigDir, "registry.json");

  // Ensure registry file exists
  try {
    await fs.access(registryPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      // Create registry file with empty pipelines object
      await fs.mkdir(pipelineConfigDir, { recursive: true });
      await fs.writeFile(
        registryPath,
        JSON.stringify({ pipelines: {} }, null, 2),
        "utf8"
      );
    } else {
      throw error;
    }
  }

  // Read existing registry
  let registryData;
  try {
    const contents = await fs.readFile(registryPath, "utf8");
    registryData = JSON.parse(contents);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return configBridge.createErrorResponse(
        configBridge.Constants.ERROR_CODES.INVALID_JSON,
        "Invalid JSON in pipeline registry",
        registryPath
      );
    }
    throw error;
  }

  // Validate registry structure
  if (
    !registryData ||
    typeof registryData !== "object" ||
    !registryData.pipelines ||
    typeof registryData.pipelines !== "object"
  ) {
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.INVALID_JSON,
      "Invalid pipeline registry format: expected 'pipelines' object",
      registryPath
    );
  }

  // Generate unique slug
  const baseSlug = generateSlug(name.trim());
  const existingSlugs = new Set(Object.keys(registryData.pipelines));
  const slug = ensureUniqueSlug(baseSlug, existingSlugs);

  // Generate paths
  const pipelineDir = path.join(pipelineConfigDir, slug);
  const pipelinePath = path.join("pipeline-config", slug, "pipeline.json");
  const taskRegistryPath = path.join("pipeline-config", slug, "tasks/index.js");

  // Create starter files
  try {
    await createStarterFiles(pipelineDir, name.trim(), description.trim());
  } catch (error) {
    console.error("[CreatePipelineEndpoint] Failed to create files:", error);
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.FS_ERROR,
      "Failed to create pipeline files"
    );
  }

  // Update registry
  try {
    registryData.pipelines[slug] = {
      name: name.trim(),
      description: description.trim(),
      pipelinePath,
      taskRegistryPath,
    };

    await fs.writeFile(
      registryPath,
      JSON.stringify(registryData, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("[CreatePipelineEndpoint] Failed to update registry:", error);
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.FS_ERROR,
      "Failed to update pipeline registry"
    );
  }

  console.log("[CreatePipelineEndpoint] Pipeline created successfully:", slug);

  return {
    ok: true,
    data: {
      slug,
      name: name.trim(),
      description: description.trim(),
      pipelinePath,
      taskRegistryPath,
    },
  };
}

/**
 * HTTP wrapper function for create pipeline requests.
 * Calls handleCreatePipelineRequest() and sends the response using sendJson().
 */
export async function handleCreatePipelineHttpRequest(req, res) {
  console.info(
    "[CreatePipelineEndpoint] handleCreatePipelineHttpRequest called"
  );

  try {
    const { name, description } = req.body;

    const result = await handleCreatePipelineRequest(name, description);

    if (result.ok) {
      sendJson(res, 200, result);
    } else {
      // Map error codes to appropriate HTTP status codes
      const statusCode =
        result.code === configBridge.Constants.ERROR_CODES.VALIDATION_ERROR
          ? 400
          : 500;
      sendJson(res, statusCode, result);
    }
  } catch (err) {
    console.error("handleCreatePipelineHttpRequest unexpected error:", err);
    sendJson(res, 500, {
      ok: false,
      code: "internal_error",
      message: "Internal server error",
    });
  }
}
