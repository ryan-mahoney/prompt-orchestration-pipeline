import { describe, it, expect } from "vitest";
import { runJsonlSubprocess } from "../subprocess.ts";

describe("runJsonlSubprocess", () => {
  it("parses two JSONL lines into two events", async () => {
    const result = await runJsonlSubprocess({
      argv: [
        "bun",
        "-e",
        'console.log(JSON.stringify({a:1})); console.log(JSON.stringify({b:2}))',
      ],
      env: {},
      timeoutMs: 5000,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual({ a: 1 });
    expect(result.events[1]).toEqual({ b: 2 });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("skips malformed lines without throwing", async () => {
    const result = await runJsonlSubprocess({
      argv: [
        "bun",
        "-e",
        'console.log(JSON.stringify({valid:true})); console.log("not json")',
      ],
      env: {},
      timeoutMs: 5000,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({ valid: true });
    expect(result.exitCode).toBe(0);
  });

  it("resolves with timedOut when process exceeds timeoutMs", async () => {
    const result = await runJsonlSubprocess({
      argv: ["sleep", "10"],
      env: {},
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 5000);

  it("reports non-zero exit via exitCode and stderr", async () => {
    const result = await runJsonlSubprocess({
      argv: ["bun", "-e", 'console.error("oops"); process.exit(1)'],
      env: {},
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("oops");
    expect(result.timedOut).toBe(false);
  });
});
