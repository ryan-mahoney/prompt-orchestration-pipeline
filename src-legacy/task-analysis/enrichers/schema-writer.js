import fs from "node:fs/promises";
import path from "node:path";

/**
 * Write schema, sample, and meta files for an artifact.
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
  // Validate that deducedData contains all required properties
  if (!deducedData || typeof deducedData !== "object") {
    throw new Error(
      `Invalid deducedData: expected an object but got ${typeof deducedData}`
    );
  }

  if (!deducedData.schema || typeof deducedData.schema !== "object") {
    throw new Error(
      `Invalid deducedData.schema: expected an object but got ${typeof deducedData.schema}`
    );
  }

  if (deducedData.example === undefined || deducedData.example === null) {
    throw new Error(
      `Invalid deducedData.example: expected a value but got ${deducedData.example}`
    );
  }

  if (typeof deducedData.reasoning !== "string") {
    throw new Error(
      `Invalid deducedData.reasoning: expected a string but got ${typeof deducedData.reasoning}`
    );
  }

  const schemasDir = path.join(pipelinePath, "schemas");
  await fs.mkdir(schemasDir, { recursive: true });

  const baseName = path.parse(artifactName).name;

  // 1. Write pure schema (valid JSON Schema Draft-07)
  await fs.writeFile(
    path.join(schemasDir, `${baseName}.schema.json`),
    JSON.stringify(deducedData.schema, null, 2)
  );

  // 2. Write sample data (plain JSON)
  await fs.writeFile(
    path.join(schemasDir, `${baseName}.sample.json`),
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
