import { describe, test, expect, spyOn } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRunEvent, type RunEvent } from "../run-events";

describe("appendRunEvent", () => {
  test("two appends produce two parseable ordered lines", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "run-events-"));

    try {
      const first = {
        type: "patch_applied",
        task: "plan",
        added: ["impl-1"],
        insertAfter: "plan",
        at: "2026-06-12T12:00:00.000Z",
      } satisfies RunEvent;
      const second = {
        type: "gate_decided",
        action: "approve",
        note: "looks good",
        at: "2026-06-12T12:01:00.000Z",
      } satisfies RunEvent;

      await appendRunEvent(workDir, first);
      await appendRunEvent(workDir, second);

      const text = await readFile(join(workDir, "events.jsonl"), "utf8");
      const lines = text.trimEnd().split("\n");

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(first);
      expect(JSON.parse(lines[1]!)).toEqual(second);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("append into a deleted workDir warns and resolves without throwing", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "run-events-missing-"));
    await rm(workDir, { recursive: true, force: true });

    const warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        appendRunEvent(workDir, {
          type: "control_invalid",
          task: "plan",
          message: "bad control file",
          at: "2026-06-12T12:00:00.000Z",
        }),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("Failed to append run event");
      expect(warn.mock.calls[0]?.[0]).toContain(join(workDir, "events.jsonl"));
    } finally {
      warn.mockRestore();
    }
  });
});
