import { createHighLevelLLM } from "../../llm/index";
import { stripMarkdownFences } from "../../providers/base";

const NO_CHANGES_NEEDED = "NO_CHANGES_NEEDED";

export async function reviewAndCorrectTask(
  code: string,
  guidelines: string,
): Promise<string> {
  const llm = createHighLevelLLM();
  const response = await llm.chat({
    provider: "openai",
    messages: [
      { role: "system", content: `Review code using these guidelines:\n${guidelines}` },
      { role: "user", content: code },
    ],
  });

  if (typeof response.content !== "string") {
    throw new Error("task reviewer expected string LLM content");
  }

  const trimmed = response.content.trim();
  if (trimmed === "" || trimmed === NO_CHANGES_NEEDED) return code;
  return stripMarkdownFences(response.content);
}
