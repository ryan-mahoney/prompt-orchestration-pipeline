import path from "node:path";

import { sendJson } from "../utils/http-utils";

export async function handleSchemaFile(_req: Request, slug: string, filename: string): Promise<Response> {
  const root = process.env["PO_ROOT"] ?? process.cwd();
  const filePath = path.join(root, "pipeline-config", slug, "schemas", filename);
  if (!(await Bun.file(filePath).exists())) {
    return sendJson(404, { ok: false, code: "NOT_FOUND", message: "schema file not found" });
  }
  return sendJson(200, { ok: true, data: await Bun.file(filePath).text() });
}
