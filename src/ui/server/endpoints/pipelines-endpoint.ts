import path from "node:path";

import { getConfig } from "../../../core/config";
import { createErrorResponse } from "../config-bridge";
import { sendJson } from "../utils/http-utils";

export async function handlePipelinesList(): Promise<Response> {
  try {
    const config = getConfig();
    const data = await Promise.all(
      Object.entries(config.pipelines).map(async ([slug, entry]) => {
        const pipelinePath = path.join(entry.configDir, "pipeline.json");
        const pipeline = JSON.parse(await Bun.file(pipelinePath).text()) as Record<string, unknown>;
        return {
          slug,
          name: typeof pipeline["name"] === "string" ? pipeline["name"] : slug,
          description: typeof pipeline["description"] === "string" ? pipeline["description"] : "",
        };
      }),
    );
    return sendJson(200, { ok: true, data });
  } catch (error) {
    return sendJson(500, createErrorResponse("FS_ERROR", error instanceof Error ? error.message : String(error)));
  }
}
