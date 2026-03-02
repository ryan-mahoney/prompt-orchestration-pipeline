import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { getConfig, resetConfig } from "../../../core/config";
import { createErrorResponse } from "../config-bridge";
import { sendJson } from "../utils/http-utils";
import { ensureUniqueSlug, generateSlug } from "../utils/slug";

async function writeAtomicJson(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(value, null, 2));
  await rename(tmpPath, filePath);
}

export async function handleCreatePipeline(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const description = typeof body["description"] === "string" ? body["description"].trim() : "";
  if (!name) {
    return sendJson(400, createErrorResponse("BAD_REQUEST", "pipeline name is required"));
  }

  const root = process.env["PO_ROOT"] ?? process.cwd();
  const registryPath = path.join(root, "pipeline-config", "registry.json");
  const registry = (await Bun.file(registryPath).exists())
    ? (JSON.parse(await Bun.file(registryPath).text()) as { pipelines: Record<string, { configDir: string; tasksDir: string }> })
    : { pipelines: {} };
  const slug = ensureUniqueSlug(generateSlug(name), new Set(Object.keys(registry.pipelines)));

  const configDir = path.join(root, "pipeline-config", slug);
  const tasksDir = path.join(configDir, "tasks");
  await mkdir(tasksDir, { recursive: true });
  await Bun.write(path.join(configDir, "pipeline.json"), JSON.stringify({ name, description, slug }, null, 2));
  await registryFileUpdate(registryPath, registry, slug, configDir, tasksDir);
  resetConfig();

  return sendJson(201, { ok: true, data: { slug, name, description } });
}

async function registryFileUpdate(
  registryPath: string,
  registry: { pipelines: Record<string, { configDir: string; tasksDir: string }> },
  slug: string,
  configDir: string,
  tasksDir: string,
): Promise<void> {
  registry.pipelines[slug] = {
    configDir: path.relative(process.env["PO_ROOT"] ?? process.cwd(), configDir),
    tasksDir: path.relative(process.env["PO_ROOT"] ?? process.cwd(), tasksDir),
  };
  await writeAtomicJson(registryPath, registry);
}
