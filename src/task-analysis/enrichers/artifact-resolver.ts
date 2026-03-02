// ── src/task-analysis/enrichers/artifact-resolver.ts ──
// LLM-powered resolution of dynamic artifact references.

import { chat } from "../../llm/index.ts";
import type { UnresolvedArtifactDescriptor, ArtifactResolution } from "../types.ts";

const FALLBACK: ArtifactResolution = {
  resolvedFileName: null,
  confidence: 0,
  reasoning: "Failed to analyze artifact reference",
};

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export async function resolveArtifactReference(
  taskCode: string,
  unresolvedArtifact: UnresolvedArtifactDescriptor,
  availableArtifacts: string[],
): Promise<ArtifactResolution> {
  try {
    const messages = [
      {
        role: "system" as const,
        content:
          "You are a code analysis expert. Given pipeline task source code, a dynamic artifact expression, and a list of available artifact filenames, determine which artifact filename the expression resolves to. Respond with a JSON object containing: resolvedFileName (string or null), confidence (number between 0 and 1), and reasoning (string).",
      },
      {
        role: "user" as const,
        content: `Analyze the following pipeline task source code and determine which artifact filename the dynamic expression resolves to.

Task source code:
\`\`\`
${taskCode}
\`\`\`

Dynamic expression: ${unresolvedArtifact.expression}
Code context: ${unresolvedArtifact.codeContext}
Stage: ${unresolvedArtifact.stage}

Available artifact filenames:
${availableArtifacts.map((f) => `- ${f}`).join("\n")}

Respond with a JSON object with these fields:
- resolvedFileName: the matching filename from the available list, or null if you cannot determine it
- confidence: a number between 0 and 1 indicating your confidence
- reasoning: a string explaining your reasoning`,
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

    const { resolvedFileName, confidence, reasoning } = content as Record<string, unknown>;

    let sanitizedFileName = typeof resolvedFileName === "string" ? resolvedFileName : null;
    let sanitizedConfidence = clampConfidence(confidence);

    if (sanitizedFileName !== null && !availableArtifacts.includes(sanitizedFileName)) {
      sanitizedFileName = null;
      sanitizedConfidence = 0;
    }

    return {
      resolvedFileName: sanitizedFileName,
      confidence: sanitizedConfidence,
      reasoning: typeof reasoning === "string" ? reasoning : "",
    };
  } catch {
    return FALLBACK;
  }
}
