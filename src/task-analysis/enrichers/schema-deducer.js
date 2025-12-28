import { chat } from "../../llm/index.js";
import Ajv from "ajv";

const ajv = new Ajv();

/**
 * Deduce JSON schema for an artifact using LLM with structured output.
 *
 * @param {string} taskCode - Full source code of the task file
 * @param {object} artifact - Artifact info { fileName, stage }
 * @returns {Promise<{ schema, example, reasoning }>}
 */
export async function deduceArtifactSchema(taskCode, artifact) {
  const response = await chat({
    provider: "deepseek",
    model: "deepseek-chat",
    temperature: 0,
    responseFormat: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(taskCode, artifact) },
    ],
  });

  const result = response.content;

  // Validate the generated example against the generated schema
  const validate = ajv.compile(result.schema);
  if (!validate(result.example)) {
    throw new Error(
      `Generated example does not validate against schema: ${JSON.stringify(validate.errors)}`
    );
  }

  return {
    schema: result.schema,
    example: result.example,
    reasoning: result.reasoning,
  };
}

function buildSystemPrompt() {
  return `You are a code analysis expert that deduces JSON schemas from JavaScript source code.

Your task: Given a pipeline task's source code and a target artifact filename, extract the JSON schema that describes that artifact's structure.

ANALYSIS STRATEGY (follow this order):
1. FIRST: Look for an exported schema constant (e.g. \`export const <name>Schema = {...}\`) that matches the artifact
2. SECOND: Find the io.writeArtifact() call for this artifact and trace the data being written
3. THIRD: Look for JSON structure hints in LLM prompts, JSON.parse usage, or data transformations
4. FOURTH: If the artifact is read and validated elsewhere, check validation code for schema hints

OUTPUT REQUIREMENTS:
- Schema must be valid JSON Schema Draft-07
- Schema must include "$schema": "http://json-schema.org/draft-07/schema#"
- Schema must include "type", "properties", and "required" fields
- Example must be realistic data that validates against the schema
- Reasoning must explain your analysis steps

You must respond with a JSON object matching this exact structure:
{
  "schema": { <valid JSON Schema Draft-07> },
  "example": { <realistic example data> },
  "reasoning": "<step-by-step explanation of how you determined the schema>"
}`;
}

function buildUserPrompt(taskCode, artifact) {
  return `## Task Source Code

\`\`\`javascript
${taskCode}
\`\`\`

## Target Artifact
- Filename: ${artifact.fileName}
- Written in stage: ${artifact.stage}

## Few-Shot Example

For a task that writes "user-profile.json" with code like:
\`\`\`javascript
await io.writeArtifact("user-profile.json", JSON.stringify({
  name: user.name,
  email: user.email,
  preferences: { theme: "dark" }
}));
\`\`\`

The correct output would be:
{
  "schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["name", "email", "preferences"],
    "properties": {
      "name": { "type": "string" },
      "email": { "type": "string", "format": "email" },
      "preferences": {
        "type": "object",
        "properties": {
          "theme": { "type": "string", "enum": ["light", "dark"] }
        }
      }
    }
  },
  "example": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "preferences": { "theme": "dark" }
  },
  "reasoning": "Found io.writeArtifact call with inline object literal. Traced property types from the object structure. Added format:email based on property name convention."
}

## Your Task

Analyze the source code and produce the schema, example, and reasoning for the artifact "${artifact.fileName}" written in stage "${artifact.stage}".`;
}
