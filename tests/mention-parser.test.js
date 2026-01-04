import { describe, it, expect } from "vitest";
import { parseMentions } from "../src/ui/lib/mention-parser.js";

describe("parseMentions", () => {
  it("returns empty array for empty messages array", () => {
    expect(parseMentions([])).toEqual([]);
  });

  it("returns empty array for messages with no mentions", () => {
    const messages = [
      { role: "user", content: "Create a task that processes data" },
      { role: "assistant", content: "Sure, I can help with that" },
    ];

    expect(parseMentions(messages)).toEqual([]);
  });

  it("extracts filename from single mention", () => {
    const messages = [
      {
        role: "user",
        content: "Use @[analysis-output.json](analysis-output.json) as input",
      },
    ];

    expect(parseMentions(messages)).toEqual(["analysis-output.json"]);
  });

  it("extracts all filenames from multiple mentions in one message", () => {
    const messages = [
      {
        role: "user",
        content:
          "Read @[input.json](input.json) and write to @[output.json](output.json)",
      },
    ];

    const result = parseMentions(messages);
    expect(result).toContain("input.json");
    expect(result).toContain("output.json");
    expect(result).toHaveLength(2);
  });

  it("deduplicates mentions across messages", () => {
    const messages = [
      { role: "user", content: "Use @[data.json](data.json) for input" },
      {
        role: "assistant",
        content: "I see you mentioned @[data.json](data.json)",
      },
      { role: "user", content: "Yes, @[data.json](data.json) is important" },
    ];

    expect(parseMentions(messages)).toEqual(["data.json"]);
  });

  it("handles mixed user/assistant/system messages", () => {
    const messages = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Process @[input.json](input.json)" },
      { role: "assistant", content: "I will use @[schema.json](schema.json)" },
    ];

    const result = parseMentions(messages);
    expect(result).toContain("input.json");
    expect(result).toContain("schema.json");
    expect(result).toHaveLength(2);
  });

  it("skips messages with null/undefined content", () => {
    const messages = [
      { role: "user", content: null },
      { role: "user", content: undefined },
      { role: "user", content: "Use @[data.json](data.json)" },
    ];

    expect(parseMentions(messages)).toEqual(["data.json"]);
  });

  it("extracts id (second group) not display name (first group)", () => {
    const messages = [
      {
        role: "user",
        content: "Use @[My Display Name](actual-file.json) as input",
      },
    ];

    expect(parseMentions(messages)).toEqual(["actual-file.json"]);
  });
});
