import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  healedPath,
  binEnvVar,
  harnessBinName,
  resolveHarnessBinary,
  discoverHarnesses,
  applyHarnessDiscovery,
} from "../resolve.ts";
import { DESCRIPTORS } from "../descriptors/index.ts";
import type { HarnessDescriptor, HarnessEvent, HarnessName, HarnessProbe } from "../types.ts";

function stubDescriptor(overrides: Partial<HarnessDescriptor> & { name: HarnessName }): HarnessDescriptor {
  return {
    versionArgv: [overrides.binName ?? overrides.name, "--version"],
    buildArgv: () => [overrides.binName ?? overrides.name],
    buildEnv: () => ({ env: {} }),
    parseEvents: () => [] as HarnessEvent[],
    extractFinalMessage: () => "",
    extractUsage: () => undefined,
    extractCostUsd: () => undefined,
    extractSessionId: () => undefined,
    ...overrides,
  };
}

/** Create a temp dir holding an executable that prints `output` and exits with `code`. */
function makeFakeCli(name: string, output: string, code = 0): { dir: string; bin: string } {
  const dir = mkdtempSync(join(tmpdir(), "resolve-test-"));
  const bin = join(dir, name);
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' '${output.replace(/'/g, "")}'\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  return { dir, bin };
}

describe("healedPath", () => {
  let existingDir: string;

  beforeEach(() => {
    existingDir = mkdtempSync(join(tmpdir(), "healed-"));
  });
  afterEach(() => {
    rmSync(existingDir, { recursive: true, force: true });
  });

  it("prepends an existing extra dir and preserves the base PATH", () => {
    const result = healedPath([existingDir], "/usr/bin:/bin");
    expect(result.split(":")[0]).toBe(existingDir);
    expect(result.endsWith("/usr/bin:/bin")).toBe(true);
  });

  it("skips a dir that does not exist", () => {
    const result = healedPath(["/no/such/dir/xyz"], "/usr/bin");
    expect(result.includes("/no/such/dir/xyz")).toBe(false);
  });

  it("does not duplicate a dir already on the base PATH", () => {
    const result = healedPath([existingDir], `${existingDir}:/bin`);
    expect(result.split(":").filter((d) => d === existingDir).length).toBe(1);
  });
});

describe("binEnvVar", () => {
  it("maps a harness name to its uppercase override variable", () => {
    expect(binEnvVar("opencode")).toBe("POP_OPENCODE_BIN");
    expect(binEnvVar("claude")).toBe("POP_CLAUDE_BIN");
    expect(binEnvVar("codex")).toBe("POP_CODEX_BIN");
  });
});

describe("harnessBinName", () => {
  it("uses binName when set, else the harness name", () => {
    expect(harnessBinName(stubDescriptor({ name: "opencode", binName: "opencode" }))).toBe("opencode");
    expect(harnessBinName(stubDescriptor({ name: "claude" }))).toBe("claude");
  });
});

describe("resolveHarnessBinary", () => {
  let cli: { dir: string; bin: string };

  beforeEach(() => {
    cli = makeFakeCli("faketool", "ok");
  });
  afterEach(() => {
    rmSync(cli.dir, { recursive: true, force: true });
  });

  it("returns the override env var when it points at an existing file", () => {
    const descriptor = stubDescriptor({ name: "opencode", binName: "faketool" });
    const resolved = resolveHarnessBinary(descriptor, { POP_OPENCODE_BIN: cli.bin, PATH: "" });
    expect(resolved).toBe(cli.bin);
  });

  it("resolves via a known install dir when not on PATH", () => {
    const descriptor = stubDescriptor({ name: "opencode", binName: "faketool", binDirs: [cli.dir] });
    const resolved = resolveHarnessBinary(descriptor, { PATH: "" });
    expect(resolved).toBe(cli.bin);
  });

  it("returns null when the CLI cannot be found", () => {
    const descriptor = stubDescriptor({ name: "opencode", binName: "definitely-not-a-real-cli-xyz" });
    expect(resolveHarnessBinary(descriptor, { PATH: "" })).toBeNull();
  });
});

describe("descriptor auth interpreters", () => {
  it("claude reads loggedIn from JSON, true and false", () => {
    const i = DESCRIPTORS.claude.interpretAuthStatus!;
    expect(i({ exitCode: 0, stdout: '{"loggedIn": true, "email": "x"}', stderr: "" })).toBe(true);
    expect(i({ exitCode: 0, stdout: '{"loggedIn": false}', stderr: "" })).toBe(false);
  });

  it("claude returns null on unparseable, undeterminable output", () => {
    const i = DESCRIPTORS.claude.interpretAuthStatus!;
    expect(i({ exitCode: 0, stdout: "weird non-json", stderr: "" })).toBeNull();
  });

  it("codex distinguishes logged-in from not-logged-in", () => {
    const i = DESCRIPTORS.codex.interpretAuthStatus!;
    expect(i({ exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "" })).toBe(true);
    expect(i({ exitCode: 0, stdout: "Not logged in", stderr: "" })).toBe(false);
    expect(i({ exitCode: 1, stdout: "", stderr: "" })).toBeNull();
  });

  it("opencode counts credentials, ignoring ANSI codes", () => {
    const i = DESCRIPTORS.opencode.interpretAuthStatus!;
    expect(i({ exitCode: 0, stdout: "[0m└  5 credentials", stderr: "" })).toBe(true);
    expect(i({ exitCode: 0, stdout: "0 credentials", stderr: "" })).toBe(false);
    expect(i({ exitCode: 1, stdout: "", stderr: "" })).toBeNull();
  });
});

describe("discoverHarnesses", () => {
  let cli: { dir: string; bin: string };

  beforeEach(() => {
    cli = makeFakeCli("faketool", "AUTH_OK");
  });
  afterEach(() => {
    rmSync(cli.dir, { recursive: true, force: true });
  });

  it("reports resolved path and auth result for a found CLI", async () => {
    const descriptor = stubDescriptor({
      name: "opencode",
      binName: "faketool",
      binDirs: [cli.dir],
      authStatusArgv: ["status"],
      interpretAuthStatus: ({ stdout }) => (stdout.includes("AUTH_OK") ? true : null),
    });
    const descriptors = { opencode: descriptor, claude: descriptor, codex: descriptor } as Record<HarnessName, HarnessDescriptor>;

    const probes = await discoverHarnesses(descriptors, { PATH: "" });

    expect(probes.opencode.binPath).toBe(cli.bin);
    expect(probes.opencode.available).toBe(true);
    expect(probes.opencode.authenticated).toBe(true);
  });

  it("marks a missing CLI unavailable with null auth", async () => {
    const descriptor = stubDescriptor({ name: "codex", binName: "missing-cli-xyz" });
    const descriptors = { opencode: descriptor, claude: descriptor, codex: descriptor } as Record<HarnessName, HarnessDescriptor>;

    const probes = await discoverHarnesses(descriptors, { PATH: "" });

    expect(probes.codex.available).toBe(false);
    expect(probes.codex.binPath).toBeNull();
    expect(probes.codex.authenticated).toBeNull();
  });
});

describe("applyHarnessDiscovery", () => {
  function probe(name: HarnessName, p: Partial<HarnessProbe>): HarnessProbe {
    return { name, binPath: null, available: false, authenticated: null, ...p };
  }

  it("caches resolved bins, heals PATH, and warns without blocking", () => {
    const env: Record<string, string | undefined> = { PATH: "/bin" };
    const probes: Record<HarnessName, HarnessProbe> = {
      opencode: probe("opencode", { binPath: "/x/opencode", available: true, authenticated: true }),
      claude: probe("claude", { available: false }),
      codex: probe("codex", { binPath: "/y/codex", available: true, authenticated: false }),
    };

    const messages = applyHarnessDiscovery(probes, env);

    expect(env.POP_OPENCODE_BIN).toBe("/x/opencode");
    expect(env.POP_CODEX_BIN).toBe("/y/codex");
    expect(env.POP_CLAUDE_BIN).toBeUndefined();
    expect(env.PATH!.endsWith("/bin")).toBe(true);

    const byName = (n: string) => messages.find((m) => m.message.includes(`"${n}"`))!;
    expect(byName("opencode").level).toBe("info");
    expect(byName("claude").level).toBe("warn");
    expect(byName("codex").level).toBe("warn");
  });
});
