import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { WriteOptions, TaskFileIO } from "../file-io.ts";
import type { McpIoServerHandle } from "../../harness/mcp-io-server.ts";
import type {
  HarnessRunOptions,
  HarnessRunResult,
  HarnessEvent,
} from "../../harness/types.ts";
import { runAgentStep } from "../agent-step.ts";

function createFakeIO(): TaskFileIO & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async writeArtifact(name: string, _content: string, _options?: WriteOptions) {
      calls.push(`writeArtifact:${name}`);
    },
    async writeLog(name: string, _content: string, _options?: WriteOptions) {
      calls.push(`writeLog:${name}`);
    },
    async writeTmp(name: string, _content: string, _options?: WriteOptions) {
      calls.push(`writeTmp:${name}`);
    },
    async readArtifact(name: string) {
      calls.push(`readArtifact:${name}`);
      return `artifact-content:${name}`;
    },
    async readLog(_name: string) {
      return "";
    },
    async readTmp(_name: string) {
      return "";
    },
    getTaskDir() {
      return "/fake/task/dir";
    },
    writeLogSync() {},
    getCurrentStage() {
      return "test";
    },
    getDB() {
      throw new Error("not implemented");
    },
    async runBatch() {
      throw new Error("not implemented");
    },
  };
}

function createFakeMcpHandle(
  artifacts: string[] = [],
): McpIoServerHandle & { closeSpy: ReturnType<typeof mock> } {
  const closeSpy = mock(async () => {});
  return {
    connection: { url: "http://127.0.0.1:9999/mcp", token: "fake-token" },
    artifactsWritten() {
      return [...artifacts];
    },
    close: closeSpy,
    closeSpy,
  };
}

function makeArgs(overrides?: {
  entry?: Partial<{ name: string } & Record<string, unknown>>;
  workDir?: string;
  statusPath?: string;
}) {
  return {
    entry: {
      name: "test-agent",
      harness: "claude" as const,
      prompt: "do something",
      ...overrides?.entry,
    },
    workDir: "/tmp/work",
    statusPath: "/tmp/work/tasks-status.json",
    jobId: "job-1",
    getStage: () => "test-stage",
  };
}

function makeSuccessResult(overrides?: Partial<HarnessRunResult>): HarnessRunResult {
  return {
    finalMessage: "task complete",
    events: [],
    exitCode: 0,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    costUsd: 0.12,
    sessionId: "sess-1",
    ...overrides,
  };
}

function makeDeps(result: HarnessRunResult | Error) {
  const runHarnessTask = mock(async (_opts: HarnessRunOptions) => {
    if (result instanceof Error) throw result;
    return result;
  });
  const startMcpIoServer = mock(async () => createFakeMcpHandle());
  const createTaskFileIO = mock(() => createFakeIO());
  return { runHarnessTask, startMcpIoServer, createTaskFileIO };
}

describe("runAgentStep", () => {
  it("success writes event log and agent-result.md and returns ok:true with usage/cost", async () => {
    const deps = makeDeps(makeSuccessResult());

    const result = await runAgentStep(makeArgs(), deps);

    expect(result.ok).toBe(true);
    expect(result.finalMessage).toBe("task complete");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    expect(result.costUsd).toBe(0.12);
    expect(result.sessionId).toBe("sess-1");
    expect(result.artifactsWritten).toContain("agent-result.md");
    expect(deps.startMcpIoServer).toHaveBeenCalled();
  });

  it("onEvent appends JSONL to the event log", async () => {
    let capturedIO: ReturnType<typeof createFakeIO> | undefined;
    const createTaskFileIO = mock(() => {
      const io = createFakeIO();
      capturedIO = io;
      return io;
    });

    const events: HarnessEvent[] = [
      { type: "text", raw: { text: "hello" }, text: "hello" },
      { type: "result", raw: { message: "done" } },
    ];
    const runHarnessTask = mock(async (opts: HarnessRunOptions) => {
      for (const event of events) {
        opts.onEvent?.(event);
      }
      return makeSuccessResult();
    });
    const startMcpIoServer = mock(async () => createFakeMcpHandle());

    await runAgentStep(makeArgs(), { runHarnessTask, startMcpIoServer, createTaskFileIO });

    const logCalls = capturedIO!.calls.filter((c) => c.startsWith("writeLog:"));
    expect(logCalls).toHaveLength(2);
    expect(logCalls[0]).toBe("writeLog:test-agent-agent-debug.log");
  });

  it("promptFrom reads the named artifact for the prompt", async () => {
    let capturedIO: ReturnType<typeof createFakeIO> | undefined;
    const createTaskFileIO = mock(() => {
      const io = createFakeIO();
      capturedIO = io;
      return io;
    });

    let capturedPrompt: string | undefined;
    const runHarnessTask = mock(async (opts: HarnessRunOptions) => {
      capturedPrompt = opts.prompt;
      return makeSuccessResult();
    });
    const startMcpIoServer = mock(async () => createFakeMcpHandle());

    const result = await runAgentStep(
      makeArgs({ entry: { prompt: undefined, promptFrom: "my-prompt.md" } }),
      { runHarnessTask, startMcpIoServer, createTaskFileIO },
    );

    expect(result.ok).toBe(true);
    expect(capturedIO!.calls).toContain("readArtifact:my-prompt.md");
    expect(capturedPrompt).toBe("artifact-content:my-prompt.md");
  });

  it("executor error yields ok:false with error and still calls mcpHandle.close()", async () => {
    const mcpHandle = createFakeMcpHandle();
    const createTaskFileIO = mock(() => createFakeIO());
    const deps = {
      runHarnessTask: mock(async () => {
        throw new Error("boom");
      }),
      startMcpIoServer: mock(async () => mcpHandle),
      createTaskFileIO,
    };

    const result = await runAgentStep(makeArgs(), deps);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
    expect(result.finalMessage).toBe("");
    expect(mcpHandle.closeSpy).toHaveBeenCalled();
  });

  it("MCP server is closed on success path", async () => {
    const mcpHandle = createFakeMcpHandle();
    const createTaskFileIO = mock(() => createFakeIO());
    const deps = {
      runHarnessTask: mock(async () => makeSuccessResult()),
      startMcpIoServer: mock(async () => mcpHandle),
      createTaskFileIO,
    };

    await runAgentStep(makeArgs(), deps);
    expect(mcpHandle.closeSpy).toHaveBeenCalled();
  });

  it("MCP server is closed on failure path", async () => {
    const mcpHandle = createFakeMcpHandle();
    const createTaskFileIO = mock(() => createFakeIO());
    const deps = {
      runHarnessTask: mock(async () => {
        throw new Error("fail");
      }),
      startMcpIoServer: mock(async () => mcpHandle),
      createTaskFileIO,
    };

    await runAgentStep(makeArgs(), deps);
    expect(mcpHandle.closeSpy).toHaveBeenCalled();
  });

  it("MCP server is closed on timeout path", async () => {
    const mcpHandle = createFakeMcpHandle();
    const createTaskFileIO = mock(() => createFakeIO());
    const deps = {
      runHarnessTask: mock(async () => {
        throw new Error('Harness "claude" timed out after 100ms');
      }),
      startMcpIoServer: mock(async () => mcpHandle),
      createTaskFileIO,
    };

    await runAgentStep(makeArgs({ entry: { timeoutMs: 100 } }), deps);
    expect(mcpHandle.closeSpy).toHaveBeenCalled();
  });

  it("does not start MCP server when io is false", async () => {
    const createTaskFileIO = mock(() => createFakeIO());
    const deps = {
      runHarnessTask: mock(async () => makeSuccessResult()),
      startMcpIoServer: mock(async () => createFakeMcpHandle()),
      createTaskFileIO,
    };

    const result = await runAgentStep(
      makeArgs({ entry: { io: false } }),
      deps,
    );

    expect(result.ok).toBe(true);
    expect(deps.startMcpIoServer).not.toHaveBeenCalled();
  });

  it("throws when neither prompt nor promptFrom is set", async () => {
    const deps = makeDeps(makeSuccessResult());

    await expect(
      runAgentStep(makeArgs({ entry: { prompt: undefined, promptFrom: undefined } }), deps),
    ).rejects.toThrow('must specify either "prompt" or "promptFrom"');
  });

  it("merges MCP artifacts with agent-result.md without duplicates", async () => {
    const mcpHandle = createFakeMcpHandle(["custom-artifact.md", "agent-result.md"]);
    const createTaskFileIO = mock(() => createFakeIO());
    const deps = {
      runHarnessTask: mock(async () => makeSuccessResult()),
      startMcpIoServer: mock(async () => mcpHandle),
      createTaskFileIO,
    };

    const result = await runAgentStep(makeArgs(), deps);

    expect(result.artifactsWritten).toContain("custom-artifact.md");
    expect(result.artifactsWritten).toContain("agent-result.md");
    expect(result.artifactsWritten.filter((a) => a === "agent-result.md")).toHaveLength(1);
  });
});
