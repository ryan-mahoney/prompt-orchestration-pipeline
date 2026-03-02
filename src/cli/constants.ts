export const STAGE_NAMES = [
  "ingestion",
  "preProcessing",
  "promptTemplating",
  "inference",
  "parsing",
  "validateStructure",
  "validateQuality",
  "critique",
  "refine",
  "finalValidation",
  "integration",
] as const satisfies readonly string[];

const STAGE_PURPOSES: Record<string, string> = {
  ingestion: "load/shape input for downstream stages (no external side-effects required)",
  preProcessing: "prepare and clean data for main processing",
  promptTemplating: "generate or format prompts for LLM interaction",
  inference: "execute LLM calls or other model inference",
  parsing: "extract and structure results from model outputs",
  validateStructure: "ensure output meets expected format and schema",
  validateQuality: "check content quality and completeness",
  critique: "analyze and evaluate results against criteria",
  refine: "improve and optimize outputs based on feedback",
  finalValidation: "perform final checks before completion",
  integration: "integrate results into downstream systems or workflows",
};

export function getStagePurpose(stageName: string): string {
  return STAGE_PURPOSES[stageName] ?? "";
}

export const KEBAB_CASE_REGEX = /^[a-z0-9-]+$/;
