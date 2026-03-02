// ── src/task-analysis/enrichers/schema-writer.ts ──
// Persists deduced schema, sample, and metadata files to disk.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DeducedSchema } from "../types.ts";

function validate(deducedData: DeducedSchema): void {
  const { schema, example, reasoning } = deducedData;

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(
      `Invalid schema: expected a non-null plain object, got ${Array.isArray(schema) ? "array" : typeof schema}`,
    );
  }

  if (
    typeof example !== "object" ||
    example === null ||
    Array.isArray(example)
  ) {
    throw new Error(
      `Invalid example: expected a non-null plain object, got ${Array.isArray(example) ? "array" : typeof example}`,
    );
  }

  if (typeof reasoning !== "string") {
    throw new Error(
      `Invalid reasoning: expected a string, got ${typeof reasoning}`,
    );
  }
}

export async function writeSchemaFiles(
  pipelinePath: string,
  artifactName: string,
  deducedData: DeducedSchema,
): Promise<void> {
  validate(deducedData);

  const baseName = path.parse(artifactName).name;
  const schemasDir = path.join(pipelinePath, "schemas");

  await mkdir(schemasDir, { recursive: true });

  await Promise.all([
    Bun.write(
      path.join(schemasDir, `${baseName}.schema.json`),
      JSON.stringify(deducedData.schema, null, 2),
    ),
    Bun.write(
      path.join(schemasDir, `${baseName}.sample.json`),
      JSON.stringify(deducedData.example, null, 2),
    ),
    Bun.write(
      path.join(schemasDir, `${baseName}.meta.json`),
      JSON.stringify(
        {
          source: "llm-deduction",
          generatedAt: new Date().toISOString(),
          reasoning: deducedData.reasoning,
        },
        null,
        2,
      ),
    ),
  ]);
}
