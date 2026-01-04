import { chat } from "../../llm/index.js";

const SYSTEM_PROMPT = `You are an expert code analyzer. Your task is to match a dynamic artifact reference in JavaScript code to one of the known artifact filenames.

Given:
1. The full task source code
2. A dynamic expression used as an argument to io.readArtifact() or io.writeArtifact()
3. The surrounding code context
4. A list of available artifact filenames

Analyze the code to determine what the dynamic expression likely evaluates to, then match it against the available artifacts.

Return your response as JSON with this structure:
{
  "resolvedFileName": "matched-artifact.json" or null if no match,
  "confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation of your analysis"
}

Guidelines:
- Look at variable assignments, function return values, and naming patterns
- Consider the stage name and surrounding context for clues
- Return confidence 0 if no reasonable match exists
- Only return high confidence (>=0.7) when there's strong evidence
- If multiple artifacts could match, choose the most likely one but reduce confidence`;

/**
 * Resolve a dynamic artifact reference using LLM analysis.
 *
 * @param {string} taskCode - The full task source code
 * @param {object} unresolvedArtifact - The unresolved artifact reference
 * @param {string} unresolvedArtifact.expression - The dynamic expression code
 * @param {string} unresolvedArtifact.codeContext - Surrounding code context
 * @param {string} unresolvedArtifact.stage - Stage name where the call occurs
 * @param {string[]} availableArtifacts - List of known artifact filenames
 * @returns {Promise<{resolvedFileName: string|null, confidence: number, reasoning: string}>}
 */
export async function resolveArtifactReference(
  taskCode,
  unresolvedArtifact,
  availableArtifacts
) {
  const { expression, codeContext, stage } = unresolvedArtifact;

  const userPrompt = `Task source code:
\`\`\`javascript
${taskCode}
\`\`\`

Dynamic expression: ${expression}
Stage: ${stage}
Code context:
\`\`\`javascript
${codeContext}
\`\`\`

Available artifact filenames:
${availableArtifacts.map((a) => `- ${a}`).join("\n")}

Analyze the code and determine which artifact this expression likely refers to.`;

  try {
    const response = await chat({
      provider: "deepseek",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      responseFormat: "json_object",
    });

    const parsed = JSON.parse(response.content);

    return {
      resolvedFileName: parsed.resolvedFileName ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return {
      resolvedFileName: null,
      confidence: 0,
      reasoning: "Failed to analyze artifact reference",
    };
  }
}
