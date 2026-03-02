/**
 * Task analysis endpoint
 *
 * Exports:
 *  - handleTaskAnalysisRequest(req, res) -> HTTP handler function
 *
 * Returns task analysis data if available, or null if no analysis file exists.
 */

import { getPipelineConfig } from "../../core/config.js";
import { sendJson } from "../utils/http-utils.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * HTTP handler for task analysis requests.
 *
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
export async function handleTaskAnalysisRequest(req, res) {
  const { slug, taskId } = req.params;

  // Validate slug parameter
  if (!slug || typeof slug !== "string" || !/^[A-Za-z0-9_-]+$/.test(slug)) {
    return sendJson(res, 400, {
      ok: false,
      code: "invalid_params",
      message: "Invalid slug parameter",
    });
  }

  // Validate taskId parameter
  if (
    !taskId ||
    typeof taskId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(taskId)
  ) {
    return sendJson(res, 400, {
      ok: false,
      code: "invalid_params",
      message: "Invalid taskId parameter",
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
    const analysisPath = path.join(
      pipelineDir,
      "analysis",
      `${taskId}.analysis.json`
    );

    // Attempt to read and parse analysis file
    let analysisData;
    try {
      const contents = await fs.readFile(analysisPath, "utf8");
      analysisData = JSON.parse(contents);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Analysis file doesn't exist - this is not an error
        return sendJson(res, 200, {
          ok: true,
          data: null,
        });
      }

      if (error instanceof SyntaxError) {
        return sendJson(res, 500, {
          ok: false,
          code: "invalid_json",
          message: "Invalid JSON in analysis file",
        });
      }

      throw error;
    }

    // Return analysis data
    return sendJson(res, 200, {
      ok: true,
      data: analysisData,
    });
  } catch (error) {
    console.error("handleTaskAnalysisRequest unexpected error:", error);
    return sendJson(res, 500, {
      ok: false,
      code: "internal_error",
      message: "Internal server error",
    });
  }
}
