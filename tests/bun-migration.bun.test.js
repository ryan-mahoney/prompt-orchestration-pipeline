import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

// ── Self-reexec argument builder ──────────────────────────────────────────────

describe("buildReexecArgs", () => {
  it("includes CLI source path in source mode", async () => {
    const { buildReexecArgs } = await import("../src/cli/self-reexec.js");

    const result = buildReexecArgs(["_run-job", "test-123"]);

    expect(result.execPath).toBe(process.execPath);
    // In source mode, args should include the CLI entry path + command
    expect(result.args.length).toBeGreaterThanOrEqual(3);
    expect(result.args[result.args.length - 2]).toBe("_run-job");
    expect(result.args[result.args.length - 1]).toBe("test-123");
    // The first arg should be the CLI entry file path
    expect(result.args[0]).toMatch(/index\.js$/);
  });

  it("builds args for _start-ui command", async () => {
    const { buildReexecArgs } = await import("../src/cli/self-reexec.js");

    const result = buildReexecArgs(["_start-ui"]);

    expect(result.execPath).toBe(process.execPath);
    expect(result.args[result.args.length - 1]).toBe("_start-ui");
  });

  it("builds args for _start-orchestrator command", async () => {
    const { buildReexecArgs } = await import("../src/cli/self-reexec.js");

    const result = buildReexecArgs(["_start-orchestrator"]);

    expect(result.execPath).toBe(process.execPath);
    expect(result.args[result.args.length - 1]).toBe("_start-orchestrator");
  });

  it("isCompiledBinary returns false in source mode", async () => {
    const { isCompiledBinary } = await import("../src/cli/self-reexec.js");

    // When running tests, we're in source mode
    expect(isCompiledBinary()).toBe(false);
  });
});

// ── bun:sqlite direct usage ──────────────────────────────────────────────────

describe("bun:sqlite direct usage", () => {
  it("creates in-memory database and runs queries", () => {
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");

    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
    db.prepare("INSERT INTO t (val) VALUES (?)").run("hello");
    const row = db.prepare("SELECT val FROM t WHERE id = 1").get();

    expect(row.val).toBe("hello");
    db.close();
  });

  it("supports WAL mode via exec on file-backed db", () => {
    const { Database } = require("bun:sqlite");
    const tmpPath = path.join(os.tmpdir(), `test-wal-${Date.now()}.db`);
    const db = new Database(tmpPath);

    db.exec("PRAGMA journal_mode = WAL;");
    const result = db.prepare("PRAGMA journal_mode").get();

    expect(result.journal_mode).toBe("wal");
    db.close();
    require("fs").unlinkSync(tmpPath);
  });

  it("supports readonly mode", () => {
    const { Database } = require("bun:sqlite");
    const tmpPath = path.join(os.tmpdir(), `test-readonly-${Date.now()}.db`);

    // Create db first
    const db1 = new Database(tmpPath);
    db1.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db1.close();

    // Open readonly
    const db2 = new Database(tmpPath, { readonly: true });
    expect(() => db2.exec("DROP TABLE t")).toThrow();
    db2.close();

    // Cleanup
    require("fs").unlinkSync(tmpPath);
  });
});

// ── Embedded asset map ───────────────────────────────────────────────────────

describe("embedded asset map", () => {
  it("exports embeddedAssets with index.html entry", async () => {
    const { embeddedAssets } = await import("../src/ui/embedded-assets.js");

    expect(embeddedAssets).toBeDefined();
    expect(embeddedAssets["/index.html"]).toBeDefined();
    expect(embeddedAssets["/index.html"].mime).toBe("text/html");
    expect(typeof embeddedAssets["/index.html"].path).toBe("string");
  });

  it("includes CSS assets", async () => {
    const { embeddedAssets } = await import("../src/ui/embedded-assets.js");

    const cssEntries = Object.entries(embeddedAssets).filter(
      ([, v]) => v.mime === "text/css"
    );
    expect(cssEntries.length).toBeGreaterThan(0);
  });

  it("includes JS assets", async () => {
    const { embeddedAssets } = await import("../src/ui/embedded-assets.js");

    const jsEntries = Object.entries(embeddedAssets).filter(
      ([, v]) => v.mime === "application/javascript"
    );
    expect(jsEntries.length).toBeGreaterThan(0);
  });

  it("all embedded file paths exist on disk", async () => {
    const { embeddedAssets } = await import("../src/ui/embedded-assets.js");

    for (const [requestPath, asset] of Object.entries(embeddedAssets)) {
      const exists = require("fs").existsSync(asset.path);
      expect(exists).toBe(true);
    }
  });
});

// ── Pipeline runner exported function ────────────────────────────────────────

describe("pipeline-runner exports", () => {
  it("exports runPipelineJob as a function", async () => {
    const mod = await import("../src/core/pipeline-runner.js");
    expect(typeof mod.runPipelineJob).toBe("function");
  });
});
