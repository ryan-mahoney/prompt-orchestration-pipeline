import { createHighLevelLLM } from "../../llm/index.js";
import { stripMarkdownFences } from "../../providers/base.js";

/**
 * Review and correct task code using LLM
 * @param {string} code - The task code to review
 * @param {string} guidelines - Pipeline task guidelines
 * @returns {Promise<string>} - Returns the original code if the LLM responds with
 * NO_CHANGES_NEEDED; otherwise returns the LLM's corrected code output (after
 * markdown fence stripping), which may be empty or invalid if the LLM response
 * or formatting is unexpected.
 */
export async function reviewAndCorrectTask(code, guidelines) {
  const llm = createHighLevelLLM();

  const prompt = `Review this pipeline task code for:
1. JavaScript syntax errors
2. Logic flaws or bugs
3. Violations of the pipeline task guidelines below
4. Missing error handling for io/llm operations

If the code is correct, respond with exactly: NO_CHANGES_NEEDED

If corrections are needed, respond with only the corrected code (no explanation).

## Guidelines

${guidelines}

## Code to Review

\`\`\`javascript
${code}
\`\`\``;

  const messages = [{ role: "user", content: prompt }];

  const response = await llm.chat({ messages, responseFormat: "text" });
  const content = response.content || "";

  if (content.includes("NO_CHANGES_NEEDED")) {
    return code;
  }

  return stripMarkdownFences(content);
}
