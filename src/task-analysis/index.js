import { parseTaskSource } from "./parser.js";
import { extractStages } from "./extractors/stages.js";
import {
  extractArtifactReads,
  extractArtifactWrites,
} from "./extractors/artifacts.js";
import { extractLLMCalls } from "./extractors/llm-calls.js";

/**
 * Analyze task source code and extract metadata.
 *
 * This is the main entry point for the task analysis library. It parses
 * the source code and extracts:
 * - Stages (exported functions with order and async status)
 * - Artifacts (read/write operations with stage context)
 * - Models (LLM provider and method calls with stage context)
 *
 * @param {string} code - The task source code to analyze
 * @returns {TaskAnalysis} Complete analysis of the task
 * @throws {Error} If parsing or extraction fails
 *
 * @example
 * const code = `
 *   export function ingestion({ io, llm, data, flags }) {
 *     const content = io.readArtifact("input.json");
 *     const result = llm.deepseek.chat(content);
 *     io.writeArtifact("output.json", result);
 *   }
 * `;
 * const analysis = analyzeTask(code);
 * // Returns:
 * // {
 * //   stages: [{ name: "ingestion", order: 2, isAsync: false }],
 * //   artifacts: {
 * //     reads: [{ fileName: "input.json", stage: "ingestion", required: true }],
 * //     writes: [{ fileName: "output.json", stage: "ingestion" }]
 * //   },
 * //   models: [{ provider: "deepseek", method: "chat", stage: "ingestion" }]
 * // }
 */
export function analyzeTask(code) {
  // Parse the source code into an AST
  const ast = parseTaskSource(code);

  // Extract all metadata from the AST
  const stages = extractStages(ast);
  const reads = extractArtifactReads(ast);
  const writes = extractArtifactWrites(ast);
  const models = extractLLMCalls(ast);

  // Compose into the TaskAnalysis object
  return {
    stages,
    artifacts: {
      reads,
      writes,
    },
    models,
  };
}

/**
 * @typedef {Object} TaskAnalysis
 * @property {Array<Stage>} stages - Array of exported function stages
 * @property {Object} artifacts - Artifact operations
 * @property {Array<ArtifactRead>} artifacts.reads - Artifact read operations
 * @property {Array<ArtifactWrite>} artifacts.writes - Artifact write operations
 * @property {Array<ModelCall>} models - LLM method calls
 */

/**
 * @typedef {Object} Stage
 * @property {string} name - Stage function name
 * @property {number} order - Line number for execution order
 * @property {boolean} isAsync - Whether the stage is async
 */

/**
 * @typedef {Object} ArtifactRead
 * @property {string} fileName - Name of the artifact file
 * @property {string} stage - Stage name where read occurs
 * @property {boolean} required - Whether the read is required (not wrapped in try/catch)
 */

/**
 * @typedef {Object} ArtifactWrite
 * @property {string} fileName - Name of the artifact file
 * @property {string} stage - Stage name where write occurs
 */

/**
 * @typedef {Object} ModelCall
 * @property {string} provider - LLM provider name (e.g., "deepseek", "openai")
 * @property {string} method - LLM method name (e.g., "chat", "gpt5Mini")
 * @property {string} stage - Stage name where LLM call occurs
 */
