import fs from "node:fs/promises";
import path from "node:path";

/**
 * Write schema, example, and meta files for an artifact.
 *
 * Key design: Schema files are PURE JSON Schema with no extra keys.
 * Metadata is stored in a separate .meta.json file.
 *
 * @param {string} pipelinePath - Path to pipeline directory
 * @param {string} artifactName - Artifact filename (e.g., "output.json")
 * @param {object} deducedData - Object containing { schema, example, reasoning }
 */
export async function writeSchemaFiles(
  pipelinePath,
  artifactName,
  deducedData
) {
  const schemasDir = path.join(pipelinePath, "schemas");
  await fs.mkdir(schemasDir, { recursive: true });

  const baseName = path.parse(artifactName).name;

  // 1. Write pure schema (valid JSON Schema Draft-07)
  await fs.writeFile(
    path.join(schemasDir, `${baseName}.schema.json`),
    JSON.stringify(deducedData.schema, null, 2)
  );

  // 2. Write example data (plain JSON)
  await fs.writeFile(
    path.join(schemasDir, `${baseName}.example.json`),
    JSON.stringify(deducedData.example, null, 2)
  );

  // 3. Write metadata separately (doesn't pollute schema/example)
  await fs.writeFile(
    path.join(schemasDir, `${baseName}.meta.json`),
    JSON.stringify(
      {
        source: "llm-deduction",
        generatedAt: new Date().toISOString(),
        reasoning: deducedData.reasoning,
      },
      null,
      2
    )
  );
}
