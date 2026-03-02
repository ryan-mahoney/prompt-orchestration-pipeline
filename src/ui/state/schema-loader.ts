import path from "node:path";

import { getPipelineConfig } from "../../core/config";
import type { SchemaContext } from "./types";

function getBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return (await Bun.file(filePath).json()) as Record<string, unknown>;
}

export async function loadSchemaContext(
  pipelineSlug: string,
  fileName: string,
): Promise<SchemaContext | null> {
  try {
    const { pipelineJsonPath } = getPipelineConfig(pipelineSlug);
    const baseDir = path.dirname(pipelineJsonPath);
    const baseName = getBaseName(fileName);
    const schemaPath = path.join(baseDir, "schemas", `${baseName}.schema.json`);
    const samplePath = path.join(baseDir, "schemas", `${baseName}.sample.json`);
    const metaPath = path.join(baseDir, "schemas", `${baseName}.meta.json`);

    const schema = await readJson(schemaPath);
    const sample = await readJson(samplePath);
    const metaFile = Bun.file(metaPath);
    const meta = (await metaFile.exists()) ? await readJson(metaPath) : undefined;

    return { fileName, schema, sample, meta };
  } catch {
    return null;
  }
}

export function buildSchemaPromptSection(contexts: SchemaContext[] | null | undefined): string {
  if (!contexts || contexts.length === 0) return "";

  return contexts
    .map((context) => {
      const lines = [
        `## ${context.fileName}`,
        "### Schema",
        "```json",
        JSON.stringify(context.schema, null, 2),
        "```",
        "### Sample",
        "```json",
        JSON.stringify(context.sample, null, 2),
        "```",
      ];

      if (context.meta) {
        lines.push("### Meta", "```json", JSON.stringify(context.meta, null, 2), "```");
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
