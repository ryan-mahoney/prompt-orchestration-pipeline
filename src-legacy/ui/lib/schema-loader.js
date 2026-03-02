/**
 * Schema loader utility for task creation prompt enrichment.
 * Loads JSON Schema, sample data, and metadata for referenced artifact files.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getPipelineConfig } from "../../core/config.js";

/**
 * Load schema context for a referenced artifact file.
 * @param {string} pipelineSlug - Pipeline identifier
 * @param {string} fileName - Artifact filename (e.g., "analysis-output.json")
 * @returns {Promise<{ fileName: string, schema: object, sample: object, meta?: object } | null>}
 */
export async function loadSchemaContext(pipelineSlug, fileName) {
  try {
    const pipelineConfig = getPipelineConfig(pipelineSlug);
    const pipelineDir = path.dirname(pipelineConfig.pipelineJsonPath);
    const baseName = path.parse(fileName).name;
    const schemasDir = path.join(pipelineDir, "schemas");

    const schemaPath = path.join(schemasDir, `${baseName}.schema.json`);
    const samplePath = path.join(schemasDir, `${baseName}.sample.json`);
    const metaPath = path.join(schemasDir, `${baseName}.meta.json`);

    // Schema is required - return null if missing
    const schemaContent = await fs.readFile(schemaPath, "utf8");
    const schema = JSON.parse(schemaContent);

    // Sample is required - return null if missing
    const sampleContent = await fs.readFile(samplePath, "utf8");
    const sample = JSON.parse(sampleContent);

    // Meta is optional
    let meta;
    try {
      const metaContent = await fs.readFile(metaPath, "utf8");
      meta = JSON.parse(metaContent);
    } catch {
      // Meta file missing or invalid - that's fine
    }

    return { fileName, schema, sample, meta };
  } catch {
    // Any error (pipeline not found, file missing, JSON parse error) -> return null
    return null;
  }
}

/**
 * Build markdown prompt section from schema contexts.
 * @param {Array<{ fileName: string, schema: object, sample: object, meta?: object }>} contexts
 * @returns {string} Markdown formatted section for system prompt
 */
export function buildSchemaPromptSection(contexts) {
  if (!contexts || contexts.length === 0) {
    return "";
  }

  const sections = contexts.map((ctx) => {
    let section = `### @${ctx.fileName}\n\n`;
    section += `**JSON Schema:**\n\n\`\`\`json\n${JSON.stringify(ctx.schema, null, 2)}\n\`\`\`\n\n`;
    section += `**Sample Data:**\n\n\`\`\`json\n${JSON.stringify(ctx.sample, null, 2)}\n\`\`\``;
    return section;
  });

  return `## Referenced Files\n\n${sections.join("\n\n")}`;
}
