import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.fn();

vi.mock("../../../llm/index", () => ({
  createHighLevelLLM: () => ({ chat }),
}));

import { reviewAndCorrectTask } from "../task-reviewer";

describe("task-reviewer", () => {
  beforeEach(() => {
    chat.mockReset();
  });

  it("returns the original code for exact sentinel responses", async () => {
    chat.mockResolvedValue({ content: "NO_CHANGES_NEEDED", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    await expect(reviewAndCorrectTask("const x = 1;", "rules")).resolves.toBe("const x = 1;");

    chat.mockResolvedValue({ content: "  NO_CHANGES_NEEDED  ", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    await expect(reviewAndCorrectTask("const x = 1;", "rules")).resolves.toBe("const x = 1;");
  });

  it("treats substring sentinel text as corrected output", async () => {
    chat.mockResolvedValue({
      content: "const note = 'NO_CHANGES_NEEDED but still changed';",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    await expect(reviewAndCorrectTask("const x = 1;", "rules")).resolves.toBe(
      "const note = 'NO_CHANGES_NEEDED but still changed';",
    );
  });

  it("strips markdown fences, propagates errors, and returns original code for empty output", async () => {
    chat.mockResolvedValue({
      content: "```ts\nconst y = 2;\n```",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    await expect(reviewAndCorrectTask("const x = 1;", "rules")).resolves.toBe("const y = 2;");

    chat.mockResolvedValue({ content: "   ", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    await expect(reviewAndCorrectTask("const x = 1;", "rules")).resolves.toBe("const x = 1;");

    chat.mockRejectedValue(new Error("boom"));
    await expect(reviewAndCorrectTask("const x = 1;", "rules")).rejects.toThrow("boom");
  });
});
