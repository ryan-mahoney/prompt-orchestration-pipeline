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

function makeEnvelope(innerText: string) {
  return JSON.stringify({ result: innerText });
}

function createMockProc(stdout: string, exitCode = 0, stderr = "") {
  const stdoutBlob = new Blob([stdout]);
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

  it("invokes claude CLI with --output-format json and parses response", async () => {
    const jsonPayload = { result: "success", count: 42 };
    const envelope = makeEnvelope(JSON.stringify(jsonPayload));
    spawnMock.mockReturnValue(createMockProc(envelope));

    const result = await claudeCodeChat(baseOptions);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const callArgs = spawnMock.mock.calls[0]![0] as string[];
    expect(callArgs).toContain("claude");
    expect(callArgs).toContain("--output-format");
    expect(callArgs[callArgs.indexOf("--output-format") + 1]).toBe("json");
    expect(callArgs).toContain("--model");
    expect(callArgs[callArgs.indexOf("--model") + 1]).toBe("sonnet");
    expect(callArgs).toContain("--max-turns");
    expect(callArgs[callArgs.indexOf("--max-turns") + 1]).toBe("1");

    expect(result.content).toEqual(jsonPayload);
    expect(result.text).toBe(JSON.stringify(jsonPayload));
  });

  it("reports usage as zeros", async () => {
    const envelope = makeEnvelope(JSON.stringify({ ok: true }));
    spawnMock.mockReturnValue(createMockProc(envelope));

    const result = await claudeCodeChat(baseOptions);

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it("uses custom model and maxTurns when provided", async () => {
    const envelope = makeEnvelope(JSON.stringify({ custom: true }));
    spawnMock.mockReturnValue(createMockProc(envelope));

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
    spawnMock.mockReturnValue(createMockProc("", 1, "CLI error"));

    await expect(claudeCodeChat(baseOptions)).rejects.toThrow(
      /Claude Code CLI exited with code 1/,
    );
  });

  it("returns raw envelope and text field", async () => {
    const inner = JSON.stringify({ data: "value" });
    const envelope = makeEnvelope(inner);
    spawnMock.mockReturnValue(createMockProc(envelope));

    const result = await claudeCodeChat(baseOptions);

    expect(result.raw).toEqual({ result: inner });
    expect(result.text).toBe(inner);
  });

  it("throws ProviderJsonParseError when inner text is not valid JSON", async () => {
    const plainText = "This is not JSON";
    const envelope = makeEnvelope(plainText);
    spawnMock.mockReturnValue(createMockProc(envelope));

    await expect(claudeCodeChat(baseOptions)).rejects.toBeInstanceOf(
      ProviderJsonParseError,
    );
  });

  it("combines system and user messages into the prompt", async () => {
    const envelope = makeEnvelope(JSON.stringify({ ok: true }));
    spawnMock.mockReturnValue(createMockProc(envelope));

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
    const envelope = makeEnvelope(JSON.stringify({ ok: true }));
    spawnMock.mockReturnValue(createMockProc(envelope));

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
