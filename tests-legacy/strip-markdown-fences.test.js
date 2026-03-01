import { describe, it, expect } from "vitest";
import { stripMarkdownFences } from "../src/providers/base.js";

describe("stripMarkdownFences", () => {
  it("should return non-string values unchanged", () => {
    expect(stripMarkdownFences(null)).toBe(null);
    expect(stripMarkdownFences(undefined)).toBe(undefined);
    expect(stripMarkdownFences(123)).toBe(123);
    expect(stripMarkdownFences({ key: "value" })).toEqual({ key: "value" });
  });

  it("should return plain JSON string unchanged", () => {
    const json = '{"key": "value"}';
    expect(stripMarkdownFences(json)).toBe('{"key": "value"}');
  });

  it("should strip ```json fence with newline", () => {
    const wrapped = '```json\n{"key": "value"}\n```';
    expect(stripMarkdownFences(wrapped)).toBe('{"key": "value"}');
  });

  it("should strip ```JSON fence (uppercase)", () => {
    const wrapped = '```JSON\n{"key": "value"}\n```';
    expect(stripMarkdownFences(wrapped)).toBe('{"key": "value"}');
  });

  it("should strip plain ``` fence without language", () => {
    const wrapped = '```\n{"key": "value"}\n```';
    expect(stripMarkdownFences(wrapped)).toBe('{"key": "value"}');
  });

  it("should handle fence without trailing newline before closing", () => {
    const wrapped = '```json\n{"key": "value"}```';
    expect(stripMarkdownFences(wrapped)).toBe('{"key": "value"}');
  });

  it("should handle leading/trailing whitespace", () => {
    const wrapped = '  ```json\n{"key": "value"}\n```  ';
    expect(stripMarkdownFences(wrapped)).toBe('{"key": "value"}');
  });

  it("should handle multiline JSON", () => {
    const multilineJson = `{
  "researchSummary": "Test summary",
  "keyFindings": [
    {"area": "test", "findings": "test findings"}
  ]
}`;
    const wrapped = "```json\n" + multilineJson + "\n```";
    expect(stripMarkdownFences(wrapped)).toBe(multilineJson);
  });

  it("should handle empty JSON object", () => {
    const wrapped = "```json\n{}\n```";
    expect(stripMarkdownFences(wrapped)).toBe("{}");
  });

  it("should handle JSON array", () => {
    const wrapped = "```json\n[1, 2, 3]\n```";
    expect(stripMarkdownFences(wrapped)).toBe("[1, 2, 3]");
  });

  it("should not strip text that doesn't start with backticks", () => {
    const text = 'Some text before\n```json\n{"key": "value"}\n```';
    expect(stripMarkdownFences(text)).toBe(text);
  });

  it("should handle fence with space after json", () => {
    const wrapped = '```json \n{"key": "value"}\n```';
    expect(stripMarkdownFences(wrapped)).toBe('{"key": "value"}');
  });

  it("should handle JSON with special characters", () => {
    const json = '{"message": "Hello\\nWorld", "path": "C:\\\\Users"}';
    const wrapped = "```json\n" + json + "\n```";
    expect(stripMarkdownFences(wrapped)).toBe(json);
  });

  it("should preserve content with nested backticks in strings", () => {
    const json = '{"code": "const x = `template`"}';
    const wrapped = "```json\n" + json + "\n```";
    expect(stripMarkdownFences(wrapped)).toBe(json);
  });
});

describe("stripMarkdownFences integration with JSON.parse", () => {
  it("should produce valid JSON after stripping markdown fences", () => {
    const wrapped =
      '```json\n{"researchSummary": "Test", "keyFindings": []}\n```';
    const stripped = stripMarkdownFences(wrapped);
    const parsed = JSON.parse(stripped);
    expect(parsed.researchSummary).toBe("Test");
    expect(parsed.keyFindings).toEqual([]);
  });

  it("should handle real-world LLM response format", () => {
    const llmResponse = `\`\`\`json
{
  "researchSummary": "Brief overview of the research findings",
  "keyFindings": [
    {
      "area": "name of focus area",
      "findings": "detailed information about this area",
      "sources": ["source1", "source2"]
    }
  ],
  "additionalInsights": "any other relevant information",
  "criticalPerspectives": "critical analysis and potential concerns",
  "researchCompleteness": "assessment of coverage"
}
\`\`\``;

    const stripped = stripMarkdownFences(llmResponse);
    const parsed = JSON.parse(stripped);

    expect(parsed.researchSummary).toBe(
      "Brief overview of the research findings"
    );
    expect(parsed.keyFindings).toHaveLength(1);
    expect(parsed.keyFindings[0].area).toBe("name of focus area");
    expect(parsed.additionalInsights).toBe("any other relevant information");
  });
});
