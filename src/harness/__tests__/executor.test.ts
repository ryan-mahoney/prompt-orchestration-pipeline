import { describe, it, expect, vi } from "vitest";
import { runHarnessTask, isHarnessAvailable } from "../executor.ts";
import type { RunJsonlSubprocessResult } from "../subprocess.ts";
import type { HarnessEvent, HarnessRunOptions } from "../types.ts";

vi.mock("../descriptors/index.ts", () => ({
  DESCRIPTORS: {
    claude: {
      name: "claude",
      versionArgv: ["claude", "--version"],
      buildArgv: vi.fn(() => ["claude", "-p", "test prompt"]),
      buildEnv: vi.fn(() => ({ env: {} })),
      parseEvents: vi.fn((lines: unknown[]) =>
        (lines as Record<string, unknown>[]).map((raw) => ({
          type: (raw as any).type ?? "raw",
          raw,
        })),
      ),
      extractFinalMessage: vi.fn((events: HarnessEvent[]) => {
        const result = events.find((e) => e.type === "result");
        return (result?.raw as any)?.message ?? "";
      }),
      extractUsage: vi.fn((events: HarnessEvent[]) => {
        const result = events.find((e) => e.type === "result");
        const usage = (result?.raw as any)?.usage;
        if (usage) return usage;
        return undefined;
      }),
      extractCostUsd: vi.fn((events: HarnessEvent[]) => {
        const result = events.find((e) => e.type === "result");
        return (result?.raw as any)?.costUsd;
      }),
      extractSessionId: vi.fn((events: HarnessEvent[]) => {
        const result = events.find((e) => e.type === "result");
        return (result?.raw as any)?.sessionId;
      }),
    },
  },
}));

function fakeSubprocess(result: RunJsonlSubprocessResult) {
  return vi.fn(async () => result);
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
      runHarnessTask(makeOptions(), { runJsonlSubprocess: fake }),
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

    const onEvent = vi.fn();
    await runHarnessTask(makeOptions({ onEvent }), {
      runJsonlSubprocess: fake,
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "text" }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "result" }));
  });
});

describe("isHarnessAvailable", () => {
  it("returns true when spawnSync exit code is 0", () => {
    const originalSpawnSync = Bun.spawnSync;
    (Bun as any).spawnSync = vi.fn(() => ({ exitCode: 0 }));

    try {
      expect(isHarnessAvailable("claude")).toBe(true);
    } finally {
      (Bun as any).spawnSync = originalSpawnSync;
    }
  });

  it("returns false when spawnSync exit code is non-zero", () => {
    const originalSpawnSync = Bun.spawnSync;
    (Bun as any).spawnSync = vi.fn(() => ({ exitCode: 1 }));

    try {
      expect(isHarnessAvailable("claude")).toBe(false);
    } finally {
      (Bun as any).spawnSync = originalSpawnSync;
    }
  });
});
