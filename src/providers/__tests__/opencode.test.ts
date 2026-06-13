import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  opencodeChat,
  isOpenCodeAvailable,
} from "../opencode.ts";
import type { ChatMessage, OpenCodeOptions } from "../types.ts";
import { ProviderJsonParseError } from "../types.ts";

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
    expect(rules).toHaveLength(2);
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

  it("throws when runtime config contains an invalid action", () => {
    expect(() =>
      normalizeOpenCodePermission({
        read: null,
      } as unknown as Parameters<typeof normalizeOpenCodePermission>[0]),
    ).toThrow(/Invalid OpenCode permission config/);

    expect(() =>
      normalizeOpenCodePermission({
        bash: { "*": "maybe" },
      } as unknown as Parameters<typeof normalizeOpenCodePermission>[0]),
    ).toThrow(/Invalid OpenCode permission action/);
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

const MOCK_SESSION_ID = "sess-123";

const defaultPromptData = {
  info: {
    id: "msg-1",
    sessionID: MOCK_SESSION_ID,
    role: "assistant" as const,
    modelID: "claude-sonnet-4-5",
    providerID: "anthropic",
    agent: "build",
    cost: 0,
    tokens: {
      input: 10,
      output: 5,
      total: 15,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  },
  parts: [{ type: "text" as const, text: "Hello world" }],
};

const defaultCreateData = { id: MOCK_SESSION_ID };

const mockCreate = vi.fn();
const mockPrompt = vi.fn();

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: vi.fn().mockReturnValue({
    session: {
      create: mockCreate,
      prompt: mockPrompt,
    },
  }),
}));

const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");

const baseMessages: ChatMessage[] = [{ role: "user", content: "Hello" }];

describe("opencodeChat", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockCreate.mockResolvedValue({ data: defaultCreateData, error: undefined });
    mockPrompt.mockResolvedValue({ data: defaultPromptData, error: undefined });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  describe("SDK session lifecycle", () => {
    it("uses client-only base URL from config", async () => {
      await opencodeChat({
        messages: baseMessages,
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(createOpencodeClient).toHaveBeenCalledWith({
        baseUrl: "http://localhost:3000",
      });
    });

    it("creates a fresh session by default", async () => {
      await opencodeChat({
        messages: baseMessages,
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("reuses an explicit sessionId", async () => {
      await opencodeChat({
        messages: baseMessages,
        opencode: {
          baseUrl: "http://localhost:3000",
          sessionId: "existing-id",
        },
      });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: "existing-id" }),
      );
    });

    it("applies permission rules to new sessions", async () => {
      await opencodeChat({
        messages: baseMessages,
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: [{ permission: "*", pattern: "*", action: "deny" }],
        }),
      );
    });

    it("forwards model to session.create and session.prompt", async () => {
      await opencodeChat({
        messages: baseMessages,
        model: "anthropic/claude-sonnet-4-5",
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: { id: "claude-sonnet-4-5", providerID: "anthropic" },
        }),
      );
      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        }),
      );
    });

    it("forwards agent and directory", async () => {
      await opencodeChat({
        messages: baseMessages,
        opencode: {
          baseUrl: "http://localhost:3000",
          agent: "explore",
          directory: "/tmp/project",
        },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "explore",
          directory: "/tmp/project",
        }),
      );
      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "explore",
          directory: "/tmp/project",
        }),
      );
    });

    it("throws on session creation error", async () => {
      mockCreate.mockResolvedValueOnce({
        data: undefined,
        error: { message: "forbidden" },
      });

      await expect(
        opencodeChat({
          messages: baseMessages,
          opencode: { baseUrl: "http://localhost:3000" },
        }),
      ).rejects.toThrow(/session creation failed/);
    });

    it("throws when base URL missing in SDK mode", async () => {
      delete process.env.PO_OPENCODE_BASE_URL;
      delete process.env.OPENCODE_BASE_URL;

      await expect(
        opencodeChat({
          messages: baseMessages,
          opencode: { mode: "sdk" },
        }),
      ).rejects.toThrow(/requires a base URL/);
    });

    it("uses only createOpencodeClient, not server-starting helpers", async () => {
      await opencodeChat({
        messages: baseMessages,
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(createOpencodeClient).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockPrompt).toHaveBeenCalledTimes(1);
    });

    it("passes abort signal to session.prompt", async () => {
      await opencodeChat({
        messages: baseMessages,
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  describe("SDK JSON-schema request mapping", () => {
    it("maps json_schema response format to OpenCode format", async () => {
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
      };

      mockPrompt.mockResolvedValueOnce({
        data: {
          info: { ...defaultPromptData.info, structured: { name: "test" } },
          parts: [{ type: "text", text: "ignored" }],
        },
        error: undefined,
      });

      await opencodeChat({
        messages: baseMessages,
        responseFormat: { json_schema: schema },
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          format: { type: "json_schema", schema },
        }),
      );
    });

    it("includes retryCount only when supplied", async () => {
      const schema = { type: "object" };

      mockPrompt.mockResolvedValueOnce({
        data: {
          info: { ...defaultPromptData.info, structured: { ok: true } },
          parts: [{ type: "text", text: "ignored" }],
        },
        error: undefined,
      });

      await opencodeChat({
        messages: baseMessages,
        responseFormat: { json_schema: schema },
        opencode: {
          baseUrl: "http://localhost:3000",
          structuredOutputRetryCount: 3,
        },
      });

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          format: { type: "json_schema", schema, retryCount: 3 },
        }),
      );
    });

    it("omits retryCount when structuredOutputRetryCount is undefined", async () => {
      const schema = { type: "object" };

      mockPrompt.mockResolvedValueOnce({
        data: {
          info: { ...defaultPromptData.info, structured: { ok: true } },
          parts: [{ type: "text", text: "ignored" }],
        },
        error: undefined,
      });

      await opencodeChat({
        messages: baseMessages,
        responseFormat: { json_schema: schema },
        opencode: { baseUrl: "http://localhost:3000" },
      });

      const call = mockPrompt.mock.calls[0]![0];
      expect(call.format).toEqual({ type: "json_schema", schema });
      expect(call.format).not.toHaveProperty("retryCount");
    });
  });

  describe("SDK structured output as content", () => {
    it("returns structured output as content", async () => {
      const structured = { name: "test", value: 42 };
      mockPrompt.mockResolvedValueOnce({
        data: {
          info: {
            ...defaultPromptData.info,
            structured,
          },
          parts: [{ type: "text", text: "ignored" }],
        },
        error: undefined,
      });

      const result = await opencodeChat({
        messages: baseMessages,
        responseFormat: "json",
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(result.content).toEqual(structured);
    });

    it("preserves raw SDK response", async () => {
      const rawData = {
        info: defaultPromptData.info,
        parts: [{ type: "text", text: "hi" }],
      };
      mockPrompt.mockResolvedValueOnce({
        data: rawData,
        error: undefined,
      });

      const result = await opencodeChat({
        messages: baseMessages,
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(result.raw).toBe(rawData);
    });
  });

  describe("JSON text response parsing", () => {
    it("parses fenced JSON text", async () => {
      mockPrompt.mockResolvedValueOnce({
        data: {
          info: defaultPromptData.info,
          parts: [{ type: "text", text: '```json\n{"ok": true}\n```' }],
        },
        error: undefined,
      });

      const result = await opencodeChat({
        messages: baseMessages,
        responseFormat: "json",
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(result.content).toEqual({ ok: true });
    });

    it("parses plain JSON text", async () => {
      mockPrompt.mockResolvedValueOnce({
        data: {
          info: defaultPromptData.info,
          parts: [{ type: "text", text: '{"ok":true}' }],
        },
        error: undefined,
      });

      const result = await opencodeChat({
        messages: baseMessages,
        responseFormat: "json",
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(result.content).toEqual({ ok: true });
    });
  });

  describe("JSON parse errors", () => {
    it("throws ProviderJsonParseError for invalid JSON in json mode", async () => {
      mockPrompt.mockResolvedValueOnce({
        data: {
          info: defaultPromptData.info,
          parts: [{ type: "text", text: "not json at all" }],
        },
        error: undefined,
      });

      try {
        await opencodeChat({
          messages: baseMessages,
          model: "anthropic/claude-sonnet-4-5",
          responseFormat: "json",
          opencode: { baseUrl: "http://localhost:3000" },
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderJsonParseError);
        const e = err as ProviderJsonParseError;
        expect(e.provider).toBe("opencode");
        expect(e.model).toBe("anthropic/claude-sonnet-4-5");
      }
    });

    it("throws ProviderJsonParseError for empty text in json mode", async () => {
      mockPrompt.mockResolvedValueOnce({
        data: {
          info: defaultPromptData.info,
          parts: [],
        },
        error: undefined,
      });

      await expect(
        opencodeChat({
          messages: baseMessages,
          responseFormat: "json",
          opencode: { baseUrl: "http://localhost:3000" },
        }),
      ).rejects.toBeInstanceOf(ProviderJsonParseError);
    });
  });

  describe("retry behavior", () => {
    it("retries SDK prompt abort failures", async () => {
      const timeoutError = new DOMException("operation aborted", "AbortError");
      mockPrompt
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({
          data: {
            info: defaultPromptData.info,
            parts: [{ type: "text", text: "ok" }],
          },
          error: undefined,
        });

      await expect(
        opencodeChat({
          messages: baseMessages,
          maxRetries: 1,
          responseFormat: "text",
          opencode: { baseUrl: "http://localhost:3000" },
        }),
      ).resolves.toMatchObject({ content: "ok" });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockPrompt).toHaveBeenCalledTimes(2);
    });
  });

  describe("text mode responses", () => {
    it("returns string content in text mode", async () => {
      mockPrompt.mockResolvedValueOnce({
        data: {
          info: defaultPromptData.info,
          parts: [{ type: "text", text: "Hello world" }],
        },
        error: undefined,
      });

      const result = await opencodeChat({
        messages: baseMessages,
        responseFormat: "text",
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(typeof result.content).toBe("string");
      expect(result.content).toBe("Hello world");
    });

    it("preserves raw response data in text mode", async () => {
      const rawData = {
        info: defaultPromptData.info,
        parts: [{ type: "text", text: "hi" }],
      };
      mockPrompt.mockResolvedValueOnce({
        data: rawData,
        error: undefined,
      });

      const result = await opencodeChat({
        messages: baseMessages,
        responseFormat: "text",
        opencode: { baseUrl: "http://localhost:3000" },
      });

      expect(result.raw).toBe(rawData);
    });
  });

  describe("CLI mode fallback", () => {
    it("spawns correct command arguments", async () => {
      const mockExit = Promise.resolve(0);
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              '{"type":"text","part":{"text":"hi"}}\n',
            ),
          );
          controller.close();
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: 0,
        kill: vi.fn(),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await opencodeChat({
        messages: baseMessages,
        model: "anthropic/claude-sonnet-4-5",
        opencode: { agent: "explore", directory: "/tmp/proj" },
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        [
          "opencode",
          "run",
          "--format",
          "json",
          "--model",
          "anthropic/claude-sonnet-4-5",
          "--agent",
          "explore",
          "--dir",
          "/tmp/proj",
        ],
        expect.objectContaining({
          stdout: "pipe",
          stderr: "pipe",
          env: expect.objectContaining({
            OPENCODE_PERMISSION: JSON.stringify([
              { permission: "*", pattern: "*", action: "deny" },
            ]),
          }),
        }),
      );

      spawnSpy.mockRestore();
    });

    it("sets OPENCODE_PERMISSION from caller config", async () => {
      const mockExit = Promise.resolve(0);
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              '{"type":"text","part":{"text":"ok"}}\n',
            ),
          );
          controller.close();
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: 0,
        kill: vi.fn(),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await opencodeChat({
        messages: baseMessages,
        opencode: { permission: "allow" },
      });

      const env = (spawnSpy.mock.calls[0]![1] as Record<string, unknown>)
        .env as Record<string, string>;
      expect(JSON.parse(env.OPENCODE_PERMISSION!)).toEqual([
        { permission: "*", pattern: "*", action: "allow" },
      ]);

      spawnSpy.mockRestore();
    });

    it("accumulates text from events", async () => {
      const mockExit = Promise.resolve(0);
      const events = [
        '{"type":"text","part":{"text":"Hello "}}\n',
        '{"type":"text","part":{"text":"world"}}\n',
      ];
      const mockStdout = new ReadableStream({
        start(controller) {
          for (const e of events)
            controller.enqueue(new TextEncoder().encode(e));
          controller.close();
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: 0,
        kill: vi.fn(),
      } as unknown as ReturnType<typeof Bun.spawn>);

      const result = await opencodeChat({
        messages: baseMessages,
        responseFormat: "text",
      });

      expect(result.content).toBe("Hello world");

      vi.restoreAllMocks();
    });

    it("throws on non-zero exit", async () => {
      const mockExit = Promise.resolve(1);
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode("permission denied"),
          );
          controller.close();
        },
      });

      vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: 1,
        kill: vi.fn(),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await expect(
        opencodeChat({ messages: baseMessages }),
      ).rejects.toThrow(/exited with code 1/);

      vi.restoreAllMocks();
    });

    it("tolerates malformed JSON events", async () => {
      const mockExit = Promise.resolve(0);
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("not json\n"));
          controller.enqueue(
            new TextEncoder().encode(
              '{"type":"text","part":{"text":"ok"}}\n',
            ),
          );
          controller.close();
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: 0,
        kill: vi.fn(),
      } as unknown as ReturnType<typeof Bun.spawn>);

      const result = await opencodeChat({
        messages: baseMessages,
        responseFormat: "text",
      });

      expect(result.content).toBe("ok");

      vi.restoreAllMocks();
    });

    it("kills process on timeout", async () => {
      const killFn = vi.fn();
      let resolveExit: (v: number) => void;
      const mockExit = new Promise<number>((resolve) => {
        resolveExit = resolve;
      });
      let closed = false;
      const mockStdout = new ReadableStream({
        start(controller) {
          killFn.mockImplementation(() => {
            if (!closed) {
              closed = true;
              controller.close();
              resolveExit!(1);
            }
          });
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: null,
        kill: killFn,
      } as unknown as ReturnType<typeof Bun.spawn>);

      const chatPromise = opencodeChat({
        messages: baseMessages,
        maxRetries: 0,
        requestTimeoutMs: 50,
      });

      try {
        await chatPromise;
        throw new Error("Expected OpenCode CLI timeout");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).name).toBe("TimeoutError");
        expect((err as Error).message).toMatch(/timed out/i);
      }
      expect(killFn).toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it("omits --model for default model", async () => {
      const mockExit = Promise.resolve(0);
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              '{"type":"text","part":{"text":"hi"}}\n',
            ),
          );
          controller.close();
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: 0,
        kill: vi.fn(),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await opencodeChat({
        messages: baseMessages,
      });

      const args = spawnSpy.mock.calls[0]![0] as string[];
      expect(args).not.toContain("--model");

      spawnSpy.mockRestore();
    });

    it("omits --agent/--dir/--session when not supplied", async () => {
      const mockExit = Promise.resolve(0);
      const mockStdout = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              '{"type":"text","part":{"text":"hi"}}\n',
            ),
          );
          controller.close();
        },
      });
      const mockStderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        exited: mockExit,
        exitCode: 0,
        kill: vi.fn(),
      } as unknown as ReturnType<typeof Bun.spawn>);

      await opencodeChat({
        messages: baseMessages,
      });

      const args = spawnSpy.mock.calls[0]![0] as string[];
      expect(args).not.toContain("--agent");
      expect(args).not.toContain("--dir");
      expect(args).not.toContain("--session");

      spawnSpy.mockRestore();
    });
  });
});

describe("isOpenCodeAvailable", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns true when PO_OPENCODE_BASE_URL is set", () => {
    process.env.PO_OPENCODE_BASE_URL = "http://localhost:3000";
    expect(isOpenCodeAvailable()).toBe(true);
  });

  it("returns true when OPENCODE_BASE_URL is set", () => {
    process.env.OPENCODE_BASE_URL = "http://localhost:3000";
    expect(isOpenCodeAvailable()).toBe(true);
  });

  it("returns true when CLI exits 0", () => {
    delete process.env.PO_OPENCODE_BASE_URL;
    delete process.env.OPENCODE_BASE_URL;

    vi.spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
      stdout: Buffer.from("1.0.0"),
      stderr: Buffer.from(""),
    } as unknown as ReturnType<typeof Bun.spawnSync>);

    expect(isOpenCodeAvailable()).toBe(true);
  });

  it("returns false when CLI exits non-zero", () => {
    delete process.env.PO_OPENCODE_BASE_URL;
    delete process.env.OPENCODE_BASE_URL;

    vi.spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("not found"),
    } as unknown as ReturnType<typeof Bun.spawnSync>);

    expect(isOpenCodeAvailable()).toBe(false);
  });

  it("returns false when spawnSync throws", () => {
    delete process.env.PO_OPENCODE_BASE_URL;
    delete process.env.OPENCODE_BASE_URL;

    vi.spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(isOpenCodeAvailable()).toBe(false);
  });

  it("does not pass interactive arguments", () => {
    delete process.env.PO_OPENCODE_BASE_URL;
    delete process.env.OPENCODE_BASE_URL;

    const spy = vi.spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    } as unknown as ReturnType<typeof Bun.spawnSync>);

    isOpenCodeAvailable();

    expect(spy).toHaveBeenCalledWith(["opencode", "--version"], {
      timeout: 5000,
    });
  });
});
