import { getPipelineConfig } from "../../../core/config";
import { sendJson } from "../utils/http-utils";

export async function handlePipelineArtifacts(_req: Request, slug: string): Promise<Response> {
  const { pipelineJsonPath } = getPipelineConfig(slug);
  const pipeline = JSON.parse(await Bun.file(pipelineJsonPath).text()) as Record<string, unknown>;
  return sendJson(200, { ok: true, data: pipeline["artifacts"] ?? [] });
}
