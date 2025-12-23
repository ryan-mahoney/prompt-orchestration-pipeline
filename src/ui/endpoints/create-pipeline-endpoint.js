/**
 * Create pipeline endpoint (logic-only)
 *
 * Exports:
 *  - handleCreatePipeline(req, res) -> HTTP request handler
 *
 * This function creates a new pipeline type by:
 *  - Validating name and description
 *  - Generating a slug from the provided name
 *  - Ensuring slug uniqueness in the registry
 *  - Creating directory structure and starter files
 *  - Updating the pipeline registry atomically
 */

import { getConfig } from "../../core/config.js";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Create starter files for a new pipeline
 */
async function createStarterFiles(pipelineDir, slug) {
  // Create tasks directory
  const tasksDir = path.join(pipelineDir, "tasks");
  await fs.mkdir(tasksDir, { recursive: true });

  // Create pipeline.json
  const pipelineJsonPath = path.join(pipelineDir, "pipeline.json");
  const pipelineJsonContent = JSON.stringify({ stages: [] }, null, 2);
  await fs.writeFile(pipelineJsonPath, pipelineJsonContent, "utf8");

  // Create tasks/index.js
  const tasksIndexPath = path.join(tasksDir, "index.js");
  const tasksIndexContent = `// Task registry for ${slug}\nmodule.exports = { tasks: {} };\n`;
  await fs.writeFile(tasksIndexPath, tasksIndexContent, "utf8");
}

/**
 * Handle pipeline creation request
 *
 * Behavior:
 *  - Validate name and description are present
 *  - Generate slug from name (kebab-case, max 47 chars)
 *  - Ensure slug uniqueness in registry
 *  - Create directory structure and starter files
 *  - Update registry.json atomically using temp file
 *  - Return slug on success
 */
export async function handleCreatePipeline(req, res) {
  console.log("[CreatePipelineEndpoint] POST /api/pipelines called");

  try {
    const { name, description } = req.body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "Name and description are required" });
      return;
    }

    if (
      !description ||
      typeof description !== "string" ||
      description.trim() === ""
    ) {
      res.status(400).json({ error: "Name and description are required" });
      return;
    }

    const config = getConfig();
    const rootDir = config.paths?.root;

    if (!rootDir) {
      res.status(500).json({ error: "Failed to create pipeline" });
      return;
    }

    const pipelineConfigDir = path.join(rootDir, "pipeline-config");
    const registryPath = path.join(pipelineConfigDir, "registry.json");

    // Read existing registry
    let registryData;
    try {
      const contents = await fs.readFile(registryPath, "utf8");
      registryData = JSON.parse(contents);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Create registry file with empty pipelines object
        await fs.mkdir(pipelineConfigDir, { recursive: true });
        registryData = { pipelines: {} };
      } else if (error instanceof SyntaxError) {
        console.error(
          "[CreatePipelineEndpoint] Invalid JSON in registry:",
          error
        );
        res.status(500).json({ error: "Failed to create pipeline" });
        return;
      } else {
        throw error;
      }
    }

    // Validate registry structure
    if (
      !registryData ||
      typeof registryData !== "object" ||
      !registryData.pipelines ||
      typeof registryData.pipelines !== "object"
    ) {
      console.error("[CreatePipelineEndpoint] Invalid registry structure");
      res.status(500).json({ error: "Failed to create pipeline" });
      return;
    }

    // Generate unique slug
    const baseSlug = generateSlug(name.trim());
    const existingSlugs = new Set(Object.keys(registryData.pipelines));
    const slug = ensureUniqueSlug(baseSlug, existingSlugs);

    // Generate paths
    const pipelineDir = path.join(pipelineConfigDir, slug);
    const pipelinePath = path.join("pipeline-config", slug, "pipeline.json");
    const taskRegistryPath = path.join(
      "pipeline-config",
      slug,
      "tasks/index.js"
    );

    // Create starter files
    try {
      await createStarterFiles(pipelineDir, slug);
    } catch (error) {
      console.error("[CreatePipelineEndpoint] Failed to create files:", error);
      res.status(500).json({ error: "Failed to create pipeline" });
      return;
    }

    // Update registry atomically using temp file
    try {
      registryData.pipelines[slug] = {
        name: name.trim(),
        description: description.trim(),
        pipelinePath,
        taskRegistryPath,
      };

      const tempPath = `${registryPath}.${Date.now()}.tmp`;
      await fs.writeFile(
        tempPath,
        JSON.stringify(registryData, null, 2),
        "utf8"
      );
      await fs.rename(tempPath, registryPath);
    } catch (error) {
      console.error(
        "[CreatePipelineEndpoint] Failed to update registry:",
        error
      );
      res.status(500).json({ error: "Failed to create pipeline" });
      return;
    }

    console.log(
      "[CreatePipelineEndpoint] Pipeline created successfully:",
      slug
    );

    res.status(200).json({ slug });
  } catch (err) {
    console.error("[CreatePipelineEndpoint] Unexpected error:", err);
    res.status(500).json({ error: "Failed to create pipeline" });
  }
}
