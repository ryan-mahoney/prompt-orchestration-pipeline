import { describe, expect, it } from "vitest";
import {
  parseOpenCodeModel,
  buildOpenCodePromptText,
  isJsonMode,
  jsonSchemaFromResponseFormat,
  defaultOpenCodePermission,
  normalizeOpenCodePermission,
  extractOpenCodeStructuredOutput,
  extractOpenCodeText,
  normalizeOpenCodeUsage,
} from "../opencode.ts";
import type { ChatMessage } from "../types.ts";

describe("parseOpenCodeModel", () => {
  it("returns null for undefined", () => {
    expect(parseOpenCodeModel(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseOpenCodeModel("")).toBeNull();
  });

  it('returns null for "default"', () => {
    expect(parseOpenCodeModel("default")).toBeNull();
  });

  it('parses valid "provider/model"', () => {
    const result = parseOpenCodeModel("anthropic/claude-sonnet-4-5");
    expect(result).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
  });

  it('throws for "anthropic" (no slash)', () => {
    expect(() => parseOpenCodeModel("anthropic")).toThrow(
      /expected "provider\/model" format/,
    );
  });

  it('throws for "/model" (empty provider)', () => {
    expect(() => parseOpenCodeModel("/model")).toThrow(
      /provider part is empty/,
    );
  });

  it('throws for "provider/" (empty model)', () => {
    expect(() => parseOpenCodeModel("provider/")).toThrow(
      /model part is empty/,
    );
  });

  it('throws for "provider/model/extra" (too many slashes)', () => {
    expect(() => parseOpenCodeModel("provider/model/extra")).toThrow(
      /expected "provider\/model" format/,
    );
  });
});

describe("buildOpenCodePromptText", () => {
  it("includes all message roles in order", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "How are you?" },
    ];
    const result = buildOpenCodePromptText(messages);
    expect(result).toBe(
      "system: You are helpful.\n\nuser: Hello\n\nassistant: Hi there\n\nuser: How are you?",
    );
  });

  it("handles empty messages array", () => {
    expect(buildOpenCodePromptText([])).toBe("");
  });
});

describe("isJsonMode", () => {
  it('returns true for "json"', () => {
    expect(isJsonMode("json")).toBe(true);
  });

  it('returns true for "json_object"', () => {
    expect(isJsonMode("json_object")).toBe(true);
  });

  it('returns true for { type: "json_object" }', () => {
    expect(isJsonMode({ type: "json_object" })).toBe(true);
  });

  it("returns true for { json_schema: {} }", () => {
    expect(isJsonMode({ json_schema: {} })).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isJsonMode(undefined)).toBe(false);
  });

  it('returns false for "text"', () => {
    expect(isJsonMode("text")).toBe(false);
  });
});

describe("jsonSchemaFromResponseFormat", () => {
  it("returns schema when json_schema present", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    expect(jsonSchemaFromResponseFormat({ json_schema: schema })).toBe(schema);
  });

  it("returns undefined for string format", () => {
    expect(jsonSchemaFromResponseFormat("json")).toBeUndefined();
  });

  it("returns undefined when json_schema absent", () => {
    expect(jsonSchemaFromResponseFormat({ type: "json_object" })).toBeUndefined();
  });
});

describe("defaultOpenCodePermission", () => {
  it('returns exactly { "*": "deny" }', () => {
    expect(defaultOpenCodePermission()).toEqual({ "*": "deny" });
  });
});

describe("normalizeOpenCodePermission", () => {
  it('string "deny" produces deny rule for "*"', () => {
    const rules = normalizeOpenCodePermission("deny");
    expect(rules).toEqual([{ permission: "*", pattern: "*", action: "deny" }]);
  });

  it("object with granular patterns preserves them", () => {
    const rules = normalizeOpenCodePermission({
      read: { "/tmp/*": "allow" },
      bash: "deny",
    });
    expect(rules).toContainEqual({
      permission: "read",
      pattern: "/tmp/*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "bash",
      pattern: "*",
      action: "deny",
    });
  });

  it("explicit rule array passes through unchanged", () => {
    const input = [
      { permission: "bash", pattern: "*", action: "deny" as const },
      { permission: "read", pattern: "/tmp/*", action: "allow" as const },
    ];
    expect(normalizeOpenCodePermission(input)).toBe(input);
  });

  it("no normalized default rule uses ask or allow", () => {
    const rules = normalizeOpenCodePermission(defaultOpenCodePermission());
    for (const rule of rules) {
      expect(rule.action).not.toBe("ask");
      expect(rule.action).not.toBe("allow");
    }
  });
});

describe("extractOpenCodeStructuredOutput", () => {
  it("extracts from SDK info.structured", () => {
    const structured = { name: "test", value: 42 };
    const raw = { info: { structured } };
    expect(extractOpenCodeStructuredOutput(raw)).toEqual(structured);
  });

  it("returns undefined when missing", () => {
    expect(extractOpenCodeStructuredOutput({ info: {} })).toBeUndefined();
    expect(extractOpenCodeStructuredOutput({})).toBeUndefined();
    expect(extractOpenCodeStructuredOutput(null)).toBeUndefined();
    expect(extractOpenCodeStructuredOutput(undefined)).toBeUndefined();
  });
});

describe("extractOpenCodeText", () => {
  it("extracts from SDK text parts", () => {
    const raw = {
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    };
    expect(extractOpenCodeText(raw)).toBe("Hello world");
  });

  it("extracts from CLI text events", () => {
    const raw = {
      events: [
        { type: "text", part: { text: "Hello " } },
        { type: "text", part: { text: "CLI" } },
      ],
    };
    expect(extractOpenCodeText(raw)).toBe("Hello CLI");
  });

  it("ignores unknown events and parts", () => {
    const raw = {
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "123" },
        { type: "unknown" },
      ],
      events: [
        { type: "start" },
        { type: "text", part: { text: " more" } },
        { type: "end" },
      ],
    };
    expect(extractOpenCodeText(raw)).toBe("ok more");
  });
});

describe("normalizeOpenCodeUsage", () => {
  it("normalizes from SDK metadata", () => {
    const raw = {
      info: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    };
    expect(normalizeOpenCodeUsage(raw)).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  it("returns undefined when metadata absent", () => {
    expect(normalizeOpenCodeUsage(null)).toBeUndefined();
    expect(normalizeOpenCodeUsage({})).toBeUndefined();
    expect(normalizeOpenCodeUsage({ info: {} })).toBeUndefined();
    expect(
      normalizeOpenCodeUsage({ info: { prompt_tokens: 100 } }),
    ).toBeUndefined();
  });
});
