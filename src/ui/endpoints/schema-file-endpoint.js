/**
 * Schema file endpoint
 *
 * Exports:
 *  - handleSchemaFileRequest(req, res) -> HTTP handler function
 *
 * Serves schema and sample JSON files for pipeline tasks.
 */

import { getPipelineConfig } from "../../core/config.js";
import { sendJson } from "../utils/http-utils.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * HTTP handler for schema file requests.
 *
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
export async function handleSchemaFileRequest(req, res) {
  const { slug, fileName } = req.params;
  const { type } = req.query;

  // Validate slug parameter
  if (!slug || typeof slug !== "string" || !/^[A-Za-z0-9_-]+$/.test(slug)) {
    return sendJson(res, 400, {
      ok: false,
      code: "invalid_params",
      message: "Invalid slug parameter",
    });
  }

  // Validate fileName parameter (no path traversal)
  if (
    !fileName ||
    typeof fileName !== "string" ||
    !/^[A-Za-z0-9_.-]+$/.test(fileName)
  ) {
    return sendJson(res, 400, {
      ok: false,
      code: "invalid_params",
      message: "Invalid fileName parameter",
    });
  }

  // Validate type parameter
  if (type !== "schema" && type !== "sample") {
    return sendJson(res, 400, {
      ok: false,
      code: "invalid_params",
      message: "Invalid type parameter - must be 'schema' or 'sample'",
    });
  }

  try {
    // Get pipeline configuration
    let pipelineConfig;
    try {
      pipelineConfig = getPipelineConfig(slug);
    } catch (error) {
      return sendJson(res, 404, {
        ok: false,
        code: "not_found",
        message: `Pipeline '${slug}' not found in registry`,
      });
    }

    const pipelineDir = path.dirname(pipelineConfig.pipelineJsonPath);
    const baseName = path.parse(fileName).name;
    const schemaFilePath = path.join(
      pipelineDir,
      "schemas",
      `${baseName}.${type}.json`
    );

    // Read schema file
    let fileContents;
    try {
      fileContents = await fs.readFile(schemaFilePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return sendJson(res, 404, {
          ok: false,
          code: "not_found",
          message: "Schema file not found",
        });
      }
      throw error;
    }

    // Return raw file contents (not parsed)
    return sendJson(res, 200, {
      ok: true,
      data: fileContents,
    });
  } catch (error) {
    console.error("handleSchemaFileRequest unexpected error:", error);
    return sendJson(res, 500, {
      ok: false,
      code: "internal_error",
      message: "Internal server error",
    });
  }
}
