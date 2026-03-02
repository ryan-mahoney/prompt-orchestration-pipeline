import { describe, test, expect, mock } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatusSnapshot } from "../../src/core/status-writer";

// Mirror the logger mock from status-writer.test.ts so the module resolves correctly.
const sseSpy = mock((_eventType: string, _eventData: unknown) => {});
const errorSpy = mock((_message: string, _data?: unknown) => {});

const mockLogger = {
  debug: mock(() => {}),
  log: mock(() => {}),
  warn: mock(() => {}),
  error: errorSpy,
  group: mock(() => {}),
  groupEnd: mock(() => {}),
  sse: sseSpy,
};

mock.module("../../src/core/logger", () => ({
  createJobLogger: (_component: string, _jobId: string) => mockLogger,
  createLogger: (_component: string) => mockLogger,
  createTaskLogger: (_component: string, _jobId: string, _taskName: string) => mockLogger,
}));

import { writeJobStatus, STATUS_FILENAME } from "../../src/core/status-writer";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "status-writer-integration-"));
}

describe("write serialization integration", () => {
  test("10 concurrent increments to the same jobDir produce a final counter of 10", async () => {
    const dir = await makeTempDir();

    // Initialize counter at 0.
    await writeJobStatus(dir, (s) => {
      s["counter"] = 0;
    });

    // Launch 10 concurrent increments.
    const writes = Array.from({ length: 10 }, () =>
      writeJobStatus(dir, (s) => {
        s["counter"] = ((s["counter"] as number) ?? 0) + 1;
      }),
    );

    const results = await Promise.all(writes);

    // (1) Counter equals 10 — all writes were serialized.
    const finalCounter = results[results.length - 1]["counter"] as number;
    expect(finalCounter).toBe(10);

    // (2) Collect lastUpdated values; they must all be strings (valid ISO timestamps).
    const lastUpdatedValues = results.map((r) => r.lastUpdated);
    for (const ts of lastUpdatedValues) {
      expect(typeof ts).toBe("string");
      expect(ts.length).toBeGreaterThan(0);
    }

    // (3) File on disk contains the final state with counter === 10.
    const onDisk = JSON.parse(
      await Bun.file(join(dir, STATUS_FILENAME)).text(),
    ) as StatusSnapshot;
    expect(onDisk["counter"]).toBe(10);
  });

  test("5 concurrent writes to two different jobDirs track independent counters", async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();

    // Initialize both counters at 0.
    await Promise.all([
      writeJobStatus(dir1, (s) => {
        s["counter"] = 0;
      }),
      writeJobStatus(dir2, (s) => {
        s["counter"] = 0;
      }),
    ]);

    // 5 concurrent increments to dir1, 5 concurrent increments to dir2 (10 total).
    const dir1Writes = Array.from({ length: 5 }, () =>
      writeJobStatus(dir1, (s) => {
        s["counter"] = ((s["counter"] as number) ?? 0) + 1;
      }),
    );
    const dir2Writes = Array.from({ length: 5 }, () =>
      writeJobStatus(dir2, (s) => {
        s["counter"] = ((s["counter"] as number) ?? 0) + 1;
      }),
    );

    const [dir1Results, dir2Results] = await Promise.all([
      Promise.all(dir1Writes),
      Promise.all(dir2Writes),
    ]);

    // dir1 counter is independently 5.
    const dir1Final = dir1Results[dir1Results.length - 1]["counter"] as number;
    expect(dir1Final).toBe(5);

    // dir2 counter is independently 5.
    const dir2Final = dir2Results[dir2Results.length - 1]["counter"] as number;
    expect(dir2Final).toBe(5);

    // Verify both on disk.
    const onDisk1 = JSON.parse(
      await Bun.file(join(dir1, STATUS_FILENAME)).text(),
    ) as StatusSnapshot;
    expect(onDisk1["counter"]).toBe(5);

    const onDisk2 = JSON.parse(
      await Bun.file(join(dir2, STATUS_FILENAME)).text(),
    ) as StatusSnapshot;
    expect(onDisk2["counter"]).toBe(5);
  });
});
