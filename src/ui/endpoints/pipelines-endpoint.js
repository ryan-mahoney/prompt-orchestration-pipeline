/**
 * Pipelines endpoint (logic-only)
 *
 * Exports:
 *  - handlePipelinesRequest() -> HTTP response wrapper
 *
 * This function returns structured pipeline metadata from the registry
 * so the frontend can display available pipelines.
 */

import { getConfig } from "../../core/config.js";
import { sendJson } from "../utils/http-utils.js";
import * as configBridge from "../config-bridge.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Return pipeline metadata suitable for the API.
 *
 * Behavior:
 *  - Read pipeline registry from config system
 *  - Return slug, name, description for each pipeline
 *  - Handle empty registry (return 200 with empty array)
 *  - Handle malformed JSON (return 500 with specific error)
 *  - Handle missing registry file (return 200 with empty array)
 */
export async function handlePipelinesRequest() {
  console.log("[PipelinesEndpoint] GET /api/pipelines called");

  try {
    const config = getConfig();
    const rootDir = config.paths?.root;

    if (!rootDir) {
      return configBridge.createErrorResponse(
        configBridge.Constants.ERROR_CODES.BAD_REQUEST,
        "PO_ROOT not configured"
      );
    }

    const registryPath = path.join(rootDir, "pipeline-config", "registry.json");

    // Check if registry file exists
    try {
      await fs.access(registryPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Missing registry file - return empty array as specified
        return { ok: true, data: { pipelines: [] } };
      }
      throw error;
    }

    // Read and parse registry file
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

    // Transform pipeline entries to API format
    const pipelines = [];
    for (const [slug, entry] of Object.entries(registryData.pipelines)) {
      pipelines.push({
        slug,
        name: entry?.name || slug,
        description: entry?.description || "",
      });
    }

    return { ok: true, data: { pipelines } };
  } catch (err) {
    console.error("handlePipelinesRequest error:", err);
    return configBridge.createErrorResponse(
      configBridge.Constants.ERROR_CODES.FS_ERROR,
      "Failed to read pipeline registry"
    );
  }
}

/**
 * HTTP wrapper function for pipelines requests.
 * Calls handlePipelinesRequest() and sends the response using sendJson().
 */
export async function handlePipelinesHttpRequest(req, res) {
  console.info("[PipelinesEndpoint] handlePipelinesHttpRequest called");

  try {
    const result = await handlePipelinesRequest();

    if (result.ok) {
      sendJson(res, 200, result);
    } else {
      // Map error codes to appropriate HTTP status codes
      const statusCode =
        result.code === "invalid_json" || result.code === "fs_error"
          ? 500
          : 400;
      sendJson(res, statusCode, result);
    }
  } catch (err) {
    console.error("handlePipelinesHttpRequest unexpected error:", err);
    sendJson(res, 500, {
      ok: false,
      code: "internal_error",
      message: "Internal server error",
    });
  }
}
