import { mkdir } from "node:fs/promises";
import path from "node:path";

import { sendJson } from "../utils/http-utils";

export async function handleTaskSave(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const slug = typeof body["slug"] === "string" ? body["slug"] : "";
  const taskId = typeof body["taskId"] === "string" ? body["taskId"] : "";
  const content = typeof body["content"] === "string" ? body["content"] : "";
  const root = process.env["PO_ROOT"] ?? process.cwd();
  const taskPath = path.join(root, "pipeline-config", slug, "tasks", `${taskId}.md`);
  await mkdir(path.dirname(taskPath), { recursive: true });
  await Bun.write(taskPath, content);
  return sendJson(201, { ok: true, data: { slug, taskId } });
}
