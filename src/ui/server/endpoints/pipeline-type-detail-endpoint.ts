import { getPipelineConfig } from "../../../core/config";
import { createErrorResponse } from "../config-bridge";
import { sendJson } from "../utils/http-utils";

export async function handlePipelineTypeDetail(slug: string): Promise<Response> {
  try {
    const { pipelineJsonPath } = getPipelineConfig(slug);
    const pipeline = JSON.parse(await Bun.file(pipelineJsonPath).text()) as Record<string, unknown>;
    const taskIds = Array.isArray(pipeline.tasks) ? (pipeline.tasks as string[]) : [];
    const tasks = taskIds.map((taskId) => ({
      id: taskId,
      title: taskId.charAt(0).toUpperCase() + taskId.slice(1),
      status: "definition",
    }));
    return sendJson(200, {
      ok: true,
      data: {
        ...pipeline,
        slug,
        tasks,
      },
    });
  } catch (error) {
    return sendJson(404, createErrorResponse("NOT_FOUND", error instanceof Error ? error.message : String(error)));
  }
}
