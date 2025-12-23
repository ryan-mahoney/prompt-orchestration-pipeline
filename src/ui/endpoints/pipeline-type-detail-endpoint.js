/**
 * Pipeline type detail endpoint (logic-only)
 *
 * Exports:
 *  - handlePipelineTypeDetail(slug) -> Core logic function
 *  - handlePipelineTypeDetailRequest(req, res) -> HTTP response wrapper
 *
 * This function returns a read-only pipeline definition with tasks ordered
 * as specified in pipeline.json for rendering a static DAG visualization.
 */

import { getPipelineConfig, getConfig } from "../../core/config.js";
import { sendJson } from "../utils/http-utils.js";
import * as configBridge from "../config-bridge.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Return pipeline type detail suitable for the API.
 *
 * Behavior:
 *  - Use getPipelineConfig(slug) to resolve pipeline.json path
 *  - Read and parse pipeline.json from the resolved path
 *  - Validate that parsed data contains a tasks array
 *  - Return tasks as { id, title, status: 'definition' } in order
 *  - Handle all error cases with explicit error responses
 *
 * @param {string} slug - Pipeline slug identifier
 * @returns {Object} Response envelope { ok: true, data } or error envelope
 */
export async function handlePipelineTypeDetail(slug) {
  console.log(`[PipelineTypeDetailEndpoint] GET /api/pipelines/${slug} called`);

  // Validate slug parameter
  if (!slug || typeof slug !== "string") {
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.BAD_REQUEST,
      "Invalid slug parameter"
    );
  }

  // Enforce safe characters in slug to prevent path traversal and similar issues
  const slugIsValid = /^[A-Za-z0-9_-]+$/.test(slug);
  if (!slugIsValid) {
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.BAD_REQUEST,
      "Invalid slug parameter: only letters, numbers, hyphens, and underscores are allowed"
    );
  }
  try {
    // Resolve pipeline configuration using existing config system
    let pipelineConfig;
    try {
      pipelineConfig = getPipelineConfig(slug);
    } catch (error) {
      return configBridge.createErrorResponse(
        configBridge.Constants.ERROR_CODES.NOT_FOUND,
        `Pipeline '${slug}' not found in registry`
      );
    }

    const pipelineJsonPath = pipelineConfig.pipelineJsonPath;

    // Check if pipeline.json exists
    try {
      await fs.access(pipelineJsonPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return configBridge.createErrorResponse(
          configBridge.Constants.ERROR_CODES.NOT_FOUND,
          `pipeline.json not found for pipeline '${slug}'`,
          pipelineJsonPath
        );
      }
      throw error;
    }

    // Read and parse pipeline.json
    let pipelineData;
    try {
      const contents = await fs.readFile(pipelineJsonPath, "utf8");
      pipelineData = JSON.parse(contents);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return configBridge.createErrorResponse(
          configBridge.Constants.ERROR_CODES.INVALID_JSON,
          "Invalid JSON in pipeline.json",
          pipelineJsonPath
        );
      }
      throw error;
    }

    // Validate pipeline structure
    if (
      !pipelineData ||
      typeof pipelineData !== "object" ||
      !Array.isArray(pipelineData.tasks)
    ) {
      return configBridge.createErrorResponse(
        configBridge.Constants.ERROR_CODES.INVALID_JSON,
        "Invalid pipeline.json format: expected 'tasks' array",
        pipelineJsonPath
      );
    }

    // Transform tasks to API format
    const tasks = pipelineData.tasks.map((taskId, index) => {
      if (typeof taskId !== "string" || !taskId.trim()) {
        throw new Error(`Invalid task ID at index ${index}: ${taskId}`);
      }

      return {
        id: taskId,
        title: taskId.charAt(0).toUpperCase() + taskId.slice(1),
        status: "definition",
      };
    });

    // Get pipeline metadata from config for name/description
    const config = getConfig();
    const pipelineMetadata = config.pipelines?.[slug] || {};

    return {
      ok: true,
      data: {
        slug,
        name: pipelineMetadata.name || slug,
        description: pipelineMetadata.description || "",
        tasks,
      },
    };
  } catch (err) {
    console.error("handlePipelineTypeDetail error:", err);
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.FS_ERROR,
      "Failed to read pipeline configuration"
    );
  }
}

/**
 * HTTP wrapper function for pipeline type detail requests.
 * Calls handlePipelineTypeDetail(slug) and sends the response using sendJson().
 *
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
export async function handlePipelineTypeDetailRequest(req, res) {
  console.info(
    "[PipelineTypeDetailEndpoint] handlePipelineTypeDetailRequest called"
  );

  try {
    const slug = req.params.slug;
    const result = await handlePipelineTypeDetail(slug);

    if (result.ok) {
      sendJson(res, 200, result);
    } else {
      // Map error codes to appropriate HTTP status codes
      const statusCode =
        result.code === configBridge.Constants.ERROR_CODES.NOT_FOUND
          ? 404
          : result.code === configBridge.Constants.ERROR_CODES.BAD_REQUEST
            ? 400
            : result.code === configBridge.Constants.ERROR_CODES.INVALID_JSON ||
                result.code === configBridge.Constants.ERROR_CODES.FS_ERROR
              ? 500
              : 500;
      sendJson(res, statusCode, result);
    }
  } catch (err) {
    console.error("handlePipelineTypeDetailRequest unexpected error:", err);
    sendJson(res, 500, {
      ok: false,
      code: "internal_error",
      message: "Internal server error",
    });
  }
}
