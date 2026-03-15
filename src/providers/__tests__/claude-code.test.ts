import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ProviderJsonModeError, ProviderJsonParseError } from "../types.ts";
import type { ClaudeCodeOptions } from "../types.ts";

const baseOptions: ClaudeCodeOptions = {
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Return JSON." },
  ],
  responseFormat: "json",
};

/**
 * Creates a mock proc whose stdout is a stream-json formatted stream.
 * Claude Code stream-json emits newline-delimited JSON objects.
 */
function createMockProc(
  streamEvents: Array<Record<string, unknown>>,
  exitCode = 0,
  stderr = "",
) {
  const lines = streamEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const stdoutBlob = new Blob([lines]);
  const stderrBlob = new Blob([stderr]);
  return {
    stdout: stdoutBlob.stream(),
    stderr: stderrBlob.stream(),
    exitCode,
    exited: Promise.resolve(exitCode),
    pid: 12345,
    kill: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
  };
}

/**
 * Legacy helper for backward compat — wraps text in assistant + result events.
 */
function createMockProcFromText(text: string, exitCode = 0, stderr = "") {
  const events = [
    { type: "assistant", content: [{ type: "text", text }] },
    { type: "result" },
  ];
  return createMockProc(events, exitCode, stderr);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spawnMock = vi.fn<(...args: any[]) => any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spawnSyncMock = vi.fn<(...args: any[]) => any>();

const { claudeCodeChat, isClaudeCodeAvailable } = await import(
  "../claude-code.ts"
);

describe("claudeCodeChat", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.spyOn(Bun, "spawn").mockImplementation(spawnMock);
    vi.spyOn(Bun, "spawnSync").mockImplementation(spawnSyncMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes claude CLI with --output-format stream-json and parses response", async () => {
    const jsonPayload = { result: "success", count: 42 };
    spawnMock.mockReturnValue(
      createMockProcFromText(JSON.stringify(jsonPayload)),
    );

    const result = await claudeCodeChat(baseOptions);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const callArgs = spawnMock.mock.calls[0]![0] as string[];
    expect(callArgs).toContain("claude");
    expect(callArgs).toContain("--output-format");
    expect(callArgs[callArgs.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(callArgs).toContain("--model");
    expect(callArgs[callArgs.indexOf("--model") + 1]).toBe("sonnet");
    expect(callArgs).toContain("--max-turns");
    expect(callArgs[callArgs.indexOf("--max-turns") + 1]).toBe("1");

    expect(result.content).toEqual(jsonPayload);
  });

  it("reports usage as zeros", async () => {
    spawnMock.mockReturnValue(
      createMockProcFromText(JSON.stringify({ ok: true })),
    );

    const result = await claudeCodeChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it("uses custom model and maxTurns when provided", async () => {
    spawnMock.mockReturnValue(
      createMockProcFromText(JSON.stringify({ custom: true })),
    );

    await claudeCodeChat({
      ...baseOptions,
      model: "opus",
      maxTurns: 5,
    });

    const callArgs = spawnMock.mock.calls[0]![0] as string[];
    expect(callArgs[callArgs.indexOf("--model") + 1]).toBe("opus");
    expect(callArgs[callArgs.indexOf("--max-turns") + 1]).toBe("5");
  });

  it("throws on non-zero exit code", async () => {
    spawnMock.mockReturnValue(createMockProc([], 1, "CLI error"));

    await expect(claudeCodeChat(baseOptions)).rejects.toThrow(
      /Claude Code CLI exited with code 1/,
    );
  });

  it("throws ProviderJsonParseError when accumulated text is not valid JSON", async () => {
    const plainText = "This is not JSON";
    spawnMock.mockReturnValue(createMockProcFromText(plainText));

    await expect(claudeCodeChat(baseOptions)).rejects.toBeInstanceOf(
      ProviderJsonParseError,
    );
  });

  it("combines system and user messages into the prompt", async () => {
    spawnMock.mockReturnValue(
      createMockProcFromText(JSON.stringify({ ok: true })),
    );

    await claudeCodeChat({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
    });

    const callArgs = spawnMock.mock.calls[0]![0] as string[];
    const promptIdx = callArgs.indexOf("-p");
    const prompt = callArgs[promptIdx + 1];
    expect(prompt).toContain("Be concise.");
    expect(prompt).toContain("Hello");
  });

  it("passes maxTokens to the CLI when provided", async () => {
    spawnMock.mockReturnValue(
      createMockProcFromText(JSON.stringify({ ok: true })),
    );

    await claudeCodeChat({
      ...baseOptions,
      maxTokens: 2048,
    });

    const callArgs = spawnMock.mock.calls[0]![0] as string[];
    expect(callArgs[callArgs.indexOf("--max-tokens") + 1]).toBe("2048");
  });

  it("throws ProviderJsonModeError when responseFormat is invalid", async () => {
    await expect(
      claudeCodeChat({
        ...baseOptions,
        responseFormat: "text",
      }),
    ).rejects.toBeInstanceOf(ProviderJsonModeError);
  });

  describe("streaming accumulation", () => {
    it("accumulates text across multiple assistant events", async () => {
      const events = [
        { type: "assistant", content: [{ type: "text", text: '{"he' }] },
        { type: "assistant", content: [{ type: "text", text: 'llo":"world"}' }] },
        { type: "result" },
      ];
      spawnMock.mockReturnValue(createMockProc(events));

      const result = await claudeCodeChat(baseOptions);
      expect(result.content).toEqual({ hello: "world" });
    });

    it("handles delta-style assistant events", async () => {
      const events = [
        { type: "assistant", delta: { text: '{"ok' } },
        { type: "assistant", delta: { text: '":true}' } },
        { type: "result" },
      ];
      spawnMock.mockReturnValue(createMockProc(events));

      const result = await claudeCodeChat(baseOptions);
      expect(result.content).toEqual({ ok: true });
    });
  });
});

describe("isClaudeCodeAvailable", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    vi.spyOn(Bun, "spawn").mockImplementation(spawnMock);
    vi.spyOn(Bun, "spawnSync").mockImplementation(spawnSyncMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when claude --version exits with code 0", () => {
    spawnSyncMock.mockReturnValue({
      exitCode: 0,
      stdout: Buffer.from("1.0.0"),
      stderr: Buffer.from(""),
      success: true,
    });

    expect(isClaudeCodeAvailable()).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(["claude", "--version"], {
      timeout: 5_000,
    });
  });

  it("returns false when claude --version exits with non-zero code", () => {
    spawnSyncMock.mockReturnValue({
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("not found"),
      success: false,
    });

    expect(isClaudeCodeAvailable()).toBe(false);
  });

  it("returns false when spawnSync throws", () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error("command not found");
    });

    expect(isClaudeCodeAvailable()).toBe(false);
  });
});
