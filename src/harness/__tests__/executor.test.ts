import { describe, it, expect, mock } from "bun:test";
import { runHarnessTask, isHarnessAvailable } from "../executor.ts";
import type { RunJsonlSubprocessResult } from "../subprocess.ts";
import type { HarnessDescriptor, HarnessEvent, HarnessRunOptions, HarnessName } from "../types.ts";

const fakeClaudeDescriptor: HarnessDescriptor = {
  name: "claude",
  versionArgv: ["claude", "--version"],
  buildArgv: () => ["claude", "-p", "test prompt"],
  buildEnv: () => ({ env: {} }),
  parseEvents: (lines: unknown[]) =>
    (lines as Record<string, unknown>[]).map((raw) => ({
      type: ((raw as Record<string, unknown>).type as string) ?? "raw",
      raw,
    })) as HarnessEvent[],
  extractFinalMessage: (events: HarnessEvent[]) => {
    const result = events.find((e) => e.type === "result");
    return (result?.raw as Record<string, unknown>)?.message as string ?? "";
  },
  extractUsage: (events: HarnessEvent[]) => {
    const result = events.find((e) => e.type === "result");
    const usage = (result?.raw as Record<string, unknown>)?.usage;
    if (usage) return usage as { inputTokens: number; outputTokens: number; totalTokens: number };
    return undefined;
  },
  extractCostUsd: (events: HarnessEvent[]) => {
    const result = events.find((e) => e.type === "result");
    return (result?.raw as Record<string, unknown>)?.costUsd as number | undefined;
  },
  extractSessionId: (events: HarnessEvent[]) => {
    const result = events.find((e) => e.type === "result");
    return (result?.raw as Record<string, unknown>)?.sessionId as string | undefined;
  },
};

const fakeDescriptors: Record<HarnessName, HarnessDescriptor> = {
  claude: fakeClaudeDescriptor,
  codex: fakeClaudeDescriptor,
  opencode: fakeClaudeDescriptor,
};

function fakeSubprocess(result: RunJsonlSubprocessResult) {
  return mock(async () => result);
}

function makeOptions(overrides?: Partial<HarnessRunOptions>): HarnessRunOptions {
  return {
    harness: "claude",
    prompt: "test prompt",
    cwd: "/tmp",
    ...overrides,
  };
}

describe("runHarnessTask", () => {
  it("returns finalMessage/usage/costUsd/sessionId from parsed events", async () => {
    const events = [
      { type: "result", message: "hello", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, costUsd: 0.05, sessionId: "sess-1" },
    ];
    const fake = fakeSubprocess({
      events,
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });

    const result = await runHarnessTask(makeOptions(), {
      runJsonlSubprocess: fake,
      descriptors: fakeDescriptors,
    });

    expect(result.finalMessage).toBe("hello");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(result.costUsd).toBe(0.05);
    expect(result.sessionId).toBe("sess-1");
    expect(result.exitCode).toBe(0);
  });

  it("throws error containing stderr on non-zero exitCode", async () => {
    const fake = fakeSubprocess({
      events: [],
      stdout: "",
      stderr: "something went wrong",
      exitCode: 1,
      timedOut: false,
    });

    await expect(
      runHarnessTask(makeOptions(), { runJsonlSubprocess: fake, descriptors: fakeDescriptors }),
    ).rejects.toThrow('exited with code 1: something went wrong');
  });

  it("throws timeout error when timedOut is true", async () => {
    const fake = fakeSubprocess({
      events: [],
      stdout: "",
      stderr: "killed",
      exitCode: -1,
      timedOut: true,
    });

    await expect(
      runHarnessTask(makeOptions({ timeoutMs: 100 }), {
        runJsonlSubprocess: fake,
        descriptors: fakeDescriptors,
      }),
    ).rejects.toThrow("timed out after 100ms");
  });

  it("calls onEvent for each parsed event", async () => {
    const events = [
      { type: "text", text: "hi" },
      { type: "result", message: "done" },
    ];
    const fake = fakeSubprocess({
      events,
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });

    const onEvent = mock(() => {});
    await runHarnessTask(makeOptions({ onEvent }), {
      runJsonlSubprocess: fake,
      descriptors: fakeDescriptors,
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});

describe("isHarnessAvailable", () => {
  it("returns true when spawnSync exit code is 0", async () => {
    const originalSpawnSync = Bun.spawnSync;
    (Bun as any).spawnSync = mock(() => ({ exitCode: 0 }));

    try {
      expect(await isHarnessAvailable("claude", fakeDescriptors)).toBe(true);
    } finally {
      (Bun as any).spawnSync = originalSpawnSync;
    }
  });

  it("returns false when spawnSync exit code is non-zero", async () => {
    const originalSpawnSync = Bun.spawnSync;
    (Bun as any).spawnSync = mock(() => ({ exitCode: 1 }));

    try {
      expect(await isHarnessAvailable("claude", fakeDescriptors)).toBe(false);
    } finally {
      (Bun as any).spawnSync = originalSpawnSync;
    }
  });
});
