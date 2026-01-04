/**
 * Pipeline artifacts endpoint
 *
 * Reads all *.analysis.json files, aggregates artifacts.writes,
 * returns de-duplicated list.
 *
 * Response format: { ok: true, artifacts: [{ fileName, sources: [{ taskName, stage }] }] }
 */

import { getPipelineConfig } from "../../core/config.js";
import { createErrorResponse, Constants } from "../config-bridge.js";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * HTTP handler for GET /api/pipelines/:slug/artifacts
 *
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
export async function handlePipelineArtifacts(req, res) {
  const { slug } = req.params;

  // Validate slug parameter
  if (!slug || typeof slug !== "string") {
    res
      .status(400)
      .json(
        createErrorResponse(
          Constants.ERROR_CODES.BAD_REQUEST,
          "Invalid slug parameter"
        )
      );
    return;
  }

  // Enforce safe characters in slug
  const slugIsValid = /^[A-Za-z0-9_-]+$/.test(slug);
  if (!slugIsValid) {
    res
      .status(400)
      .json(
        createErrorResponse(
          Constants.ERROR_CODES.BAD_REQUEST,
          "Invalid slug: only letters, numbers, hyphens, and underscores allowed"
        )
      );
    return;
  }

  // Get pipeline config
  let pipelineConfig;
  try {
    pipelineConfig = getPipelineConfig(slug);
  } catch {
    res
      .status(404)
      .json(
        createErrorResponse(
          Constants.ERROR_CODES.NOT_FOUND,
          `Pipeline '${slug}' not found`
        )
      );
    return;
  }

  // Determine analysis directory path
  const pipelineDir = path.dirname(pipelineConfig.pipelineJsonPath);
  const analysisDir = path.join(pipelineDir, "analysis");

  // Check if analysis directory exists
  try {
    await fs.access(analysisDir);
  } catch {
    // No analysis directory - return empty artifacts
    res.status(200).json({ ok: true, artifacts: [] });
    return;
  }

  // Read all *.analysis.json files
  const files = await fs.readdir(analysisDir);
  const analysisFiles = files.filter((f) => f.endsWith(".analysis.json"));

  // Aggregate artifacts with de-duplication
  const artifactMap = new Map();

  for (const file of analysisFiles) {
    try {
      const content = await fs.readFile(path.join(analysisDir, file), "utf8");
      const analysis = JSON.parse(content);
      const taskId = analysis.taskId || file.replace(".analysis.json", "");
      const writes = analysis.artifacts?.writes || [];

      for (const write of writes) {
        const { fileName, stage } = write;
        if (!artifactMap.has(fileName)) {
          artifactMap.set(fileName, { fileName, sources: [] });
        }
        artifactMap.get(fileName).sources.push({ taskName: taskId, stage });
      }
    } catch {
      // Skip malformed files
      continue;
    }
  }

  const artifacts = Array.from(artifactMap.values());
  res.status(200).json({ ok: true, artifacts });
}
