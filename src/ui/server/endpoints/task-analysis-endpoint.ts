import path from "node:path";

import { sendJson } from "../utils/http-utils";

export async function handleTaskAnalysis(_req: Request, slug: string, taskId: string): Promise<Response> {
  const root = process.env["PO_ROOT"] ?? process.cwd();
  const filePath = path.join(root, "pipeline-config", slug, "tasks", `${taskId}.analysis.json`);
  if (!(await Bun.file(filePath).exists())) {
    return sendJson(404, { ok: false, code: "NOT_FOUND", message: "analysis file not found" });
  }
  return sendJson(200, { ok: true, data: JSON.parse(await Bun.file(filePath).text()) });
}
