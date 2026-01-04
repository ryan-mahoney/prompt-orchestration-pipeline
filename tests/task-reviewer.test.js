import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as llmModule from "../src/llm/index.js";

describe("reviewAndCorrectTask", () => {
  let reviewAndCorrectTask;
  let mockChat;

  beforeEach(async () => {
    mockChat = vi.fn();
    vi.spyOn(llmModule, "createHighLevelLLM").mockReturnValue({
      chat: mockChat,
    });
    const module = await import("../src/ui/lib/task-reviewer.js");
    reviewAndCorrectTask = module.reviewAndCorrectTask;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns original code when LLM responds NO_CHANGES_NEEDED", async () => {
    const originalCode =
      'export default async function task() { return "ok"; }';
    const guidelines = "Some guidelines";

    mockChat.mockResolvedValue({ content: "NO_CHANGES_NEEDED" });

    const result = await reviewAndCorrectTask(originalCode, guidelines);

    expect(result).toBe(originalCode);
    expect(mockChat).toHaveBeenCalledWith({
      messages: [
        { role: "user", content: expect.stringContaining(originalCode) },
      ],
      responseFormat: "text",
    });
  });

  it("returns corrected code from LLM response", async () => {
    const originalCode = 'export default async function task() { return "ok" }';
    const correctedCode =
      'export default async function task() { return "ok"; }';
    const guidelines = "Some guidelines";

    mockChat.mockResolvedValue({ content: correctedCode });

    const result = await reviewAndCorrectTask(originalCode, guidelines);

    expect(result).toBe(correctedCode);
  });

  it("strips markdown fences from corrected code", async () => {
    const originalCode = 'export default async function task() { return "ok" }';
    const correctedCode =
      'export default async function task() { return "ok"; }';
    const wrappedCode = "```javascript\n" + correctedCode + "\n```";
    const guidelines = "Some guidelines";

    mockChat.mockResolvedValue({ content: wrappedCode });

    const result = await reviewAndCorrectTask(originalCode, guidelines);

    expect(result).toBe(correctedCode);
  });

  it("handles empty response content", async () => {
    const originalCode =
      'export default async function task() { return "ok"; }';
    const guidelines = "Some guidelines";

    mockChat.mockResolvedValue({ content: "" });

    const result = await reviewAndCorrectTask(originalCode, guidelines);

    expect(result).toBe("");
  });

  it("includes guidelines in the prompt", async () => {
    const originalCode = "const x = 1;";
    const guidelines = "Always use semicolons";

    mockChat.mockResolvedValue({ content: "NO_CHANGES_NEEDED" });

    await reviewAndCorrectTask(originalCode, guidelines);

    expect(mockChat).toHaveBeenCalledWith({
      messages: [
        { role: "user", content: expect.stringContaining(guidelines) },
      ],
      responseFormat: "text",
    });
  });
});
