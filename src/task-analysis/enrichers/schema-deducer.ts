// ── src/task-analysis/enrichers/schema-deducer.ts ──
// LLM-powered JSON Schema inference for pipeline artifacts.

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { chat } from "../../llm/index.ts";
import type { ArtifactDescriptor, DeducedSchema } from "../types.ts";

const ajv = addFormats(new Ajv());

export async function deduceArtifactSchema(
  taskCode: string,
  artifact: ArtifactDescriptor,
): Promise<DeducedSchema> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a JSON Schema expert. Analyze pipeline task source code and infer a JSON Schema Draft-07 for the given artifact. Respond with a JSON object containing: schema (a valid JSON Schema Draft-07 object), example (a concrete example object that validates against the schema), and reasoning (a string explaining your inference).",
    },
    {
      role: "user" as const,
      content: `Analyze the following pipeline task source code and infer a JSON Schema Draft-07 for the artifact named "${artifact.fileName}" used in stage "${artifact.stage}".

Task source code:
\`\`\`
${taskCode}
\`\`\`

Respond with a JSON object with these fields:
- schema: a valid JSON Schema Draft-07 object (include "$schema" and "$id" fields)
- example: a concrete example object that validates against the schema (must be a plain object, not a primitive or array)
- reasoning: a string explaining how you inferred the schema from the code`,
    },
  ];

  const response = await chat({
    provider: "deepseek",
    model: "deepseek-chat",
    messages,
    temperature: 0,
    responseFormat: { type: "json_object" },
  });

  const { content } = response;

  if (typeof content !== "object" || content === null) {
    throw new Error(
      `Unexpected gateway response: content must be a non-null object, got ${typeof content}`,
    );
  }

  const { schema, example, reasoning } = content as Record<string, unknown>;

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(
      `Invalid schema field: expected a non-null plain object, got ${Array.isArray(schema) ? "array" : typeof schema}`,
    );
  }

  if (
    typeof example !== "object" ||
    example === null ||
    Array.isArray(example)
  ) {
    throw new Error(
      `Invalid example field: expected a non-null plain object, got ${Array.isArray(example) ? "array" : typeof example}`,
    );
  }

  if (typeof reasoning !== "string") {
    throw new Error(
      `Invalid reasoning field: expected a string, got ${typeof reasoning}`,
    );
  }

  const schemaObj = schema as Record<string, unknown>;
  const schemaId = schemaObj["$id"] as string | undefined;

  if (schemaId && ajv.getSchema(schemaId)) {
    ajv.removeSchema(schemaId);
  }

  const validate = ajv.compile(schemaObj);
  if (!validate(example)) {
    const errors = ajv.errorsText(validate.errors);
    throw new Error(`Example does not validate against schema: ${errors}`);
  }

  return {
    schema: schemaObj,
    example: example as Record<string, unknown>,
    reasoning,
  };
}
