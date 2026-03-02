import { parseTaskSource } from "./parser.ts";
import { extractStages } from "./extractors/stages.ts";
import { extractArtifactReads, extractArtifactWrites } from "./extractors/artifacts.ts";
import { extractLLMCalls } from "./extractors/llm-calls.ts";
import type { TaskAnalysis } from "./types.ts";

export function analyzeTask(
  code: string,
  taskFilePath?: string | null
): TaskAnalysis {
  const ast = parseTaskSource(code);
  const stages = extractStages(ast);
  const { reads, unresolvedReads } = extractArtifactReads(ast, code);
  const { writes, unresolvedWrites } = extractArtifactWrites(ast, code);
  const models = extractLLMCalls(ast);

  return {
    taskFilePath: taskFilePath ?? null,
    stages,
    artifacts: { reads, writes, unresolvedReads, unresolvedWrites },
    models,
  };
}

export { parseTaskSource } from "./parser.ts";
export { extractStages } from "./extractors/stages.ts";
export {
  extractArtifactReads,
  extractArtifactWrites,
  extractCodeContext,
} from "./extractors/artifacts.ts";
export { extractLLMCalls } from "./extractors/llm-calls.ts";
export { isInsideTryCatch, getStageName } from "./utils/ast.ts";

export { deduceArtifactSchema } from "./enrichers/schema-deducer.ts";
export { resolveArtifactReference } from "./enrichers/artifact-resolver.ts";
export { writeSchemaFiles } from "./enrichers/schema-writer.ts";
export { writeAnalysisFile } from "./enrichers/analysis-writer.ts";

export type * from "./types.ts";
