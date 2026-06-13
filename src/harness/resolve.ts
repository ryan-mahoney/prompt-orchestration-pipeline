import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AuthStatusResult,
  HarnessDescriptor,
  HarnessName,
  HarnessProbe,
} from "./types.ts";

/** How long to wait for a CLI's auth-status command before giving up (advisory only). */
const AUTH_PROBE_TIMEOUT_MS = 10_000;

type EnvLike = Record<string, string | undefined>;

/** Expand a leading "~/" to the user's home directory. */
function expandTilde(dir: string): string {
  if (dir === "~") return homedir();
  if (dir.startsWith("~/")) return join(homedir(), dir.slice(2));
  return dir;
}

/**
 * Standard user/local bin dirs that interactive shells add (via .zshrc etc.) but
 * GUI/launchd/cron launches usually miss. Prepended to PATH so the harness — and
 * the agent's own child tools (git, rg, node) — resolve regardless of how POP started.
 */
export function standardBinDirs(): string[] {
  const home = homedir();
  return [
    join(home, ".opencode/bin"),
    join(home, ".local/bin"),
    join(home, ".bun/bin"),
    join(home, ".cargo/bin"),
    join(home, ".npm-global/bin"),
    join(home, ".deno/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

/**
 * Build a PATH with known bin dirs prepended — descriptor-specific dirs first, then
 * the standard set — keeping only dirs that exist and are not already present.
 */
export function healedPath(extraDirs: readonly string[] = [], basePath: string = process.env.PATH ?? ""): string {
  const current = basePath.split(":").filter(Boolean);
  const seen = new Set(current);
  const prepend: string[] = [];
  for (const raw of [...extraDirs, ...standardBinDirs()]) {
    const dir = expandTilde(raw);
    if (dir && !seen.has(dir) && existsSync(dir)) {
      prepend.push(dir);
      seen.add(dir);
    }
  }
  return [...prepend, ...current].join(":");
}

/** Env var that pins a harness CLI to an absolute path, e.g. "opencode" -> POP_OPENCODE_BIN. */
export function binEnvVar(name: HarnessName): string {
  return `POP_${name.toUpperCase()}_BIN`;
}

/** The command used to launch a harness (descriptor override, else the harness name). */
export function harnessBinName(descriptor: HarnessDescriptor): string {
  return descriptor.binName ?? descriptor.name;
}

/**
 * Resolve a harness CLI to an absolute path: explicit override env var → PATH search
 * (with known install dirs healed in) → null when it cannot be found.
 */
export function resolveHarnessBinary(
  descriptor: HarnessDescriptor,
  env: EnvLike = process.env,
): string | null {
  const override = env[binEnvVar(descriptor.name)];
  if (override && existsSync(override)) return override;

  const path = healedPath(descriptor.binDirs ?? [], env.PATH ?? "");
  return Bun.which(harnessBinName(descriptor), { PATH: path });
}

/**
 * Run the harness CLI's own auth-status command and interpret the result.
 * Best-effort and advisory: returns null on any timeout/spawn error, missing
 * config, or undeterminable output. Never throws.
 */
export async function probeHarnessAuth(
  descriptor: HarnessDescriptor,
  binPath: string,
  env: EnvLike = process.env,
): Promise<boolean | null> {
  if (!descriptor.authStatusArgv || !descriptor.interpretAuthStatus) return null;

  try {
    const proc = Bun.spawn([binPath, ...descriptor.authStatusArgv], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, PATH: healedPath(descriptor.binDirs ?? [], env.PATH ?? "") } as Record<string, string>,
    });
    const timer = setTimeout(() => proc.kill(), AUTH_PROBE_TIMEOUT_MS);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    clearTimeout(timer);

    const result: AuthStatusResult = { exitCode: proc.exitCode ?? -1, stdout, stderr };
    return descriptor.interpretAuthStatus(result);
  } catch {
    return null;
  }
}

/** Probe every harness once: resolve its CLI and (if found) check auth. */
export async function discoverHarnesses(
  descriptors?: Record<HarnessName, HarnessDescriptor>,
  env: EnvLike = process.env,
): Promise<Record<HarnessName, HarnessProbe>> {
  const map = descriptors ?? (await import("./descriptors/index.ts")).DESCRIPTORS;
  const out = {} as Record<HarnessName, HarnessProbe>;

  await Promise.all(
    (Object.keys(map) as HarnessName[]).map(async (name) => {
      const descriptor = map[name];
      const binPath = resolveHarnessBinary(descriptor, env);
      const authenticated = binPath ? await probeHarnessAuth(descriptor, binPath, env) : null;
      out[name] = { name, binPath, available: binPath !== null, authenticated };
    }),
  );

  return out;
}

export interface PreflightMessage {
  level: "info" | "warn";
  message: string;
}

/**
 * Apply discovery results to an env object (heal PATH, cache resolved absolute paths
 * as POP_<HARNESS>_BIN) and return human-readable status/warning messages. Pure aside
 * from the passed `env` object — never blocks, only warns.
 */
export function applyHarnessDiscovery(
  probes: Record<HarnessName, HarnessProbe>,
  env: EnvLike,
): PreflightMessage[] {
  env.PATH = healedPath([], env.PATH ?? "");

  const messages: PreflightMessage[] = [];
  for (const probe of Object.values(probes)) {
    if (probe.binPath) env[binEnvVar(probe.name)] = probe.binPath;

    if (!probe.available) {
      messages.push({
        level: "warn",
        message: `harness "${probe.name}": CLI not found on PATH or known install dirs; agent steps using it will fail until it is installed`,
      });
    } else if (probe.authenticated === false) {
      messages.push({
        level: "warn",
        message: `harness "${probe.name}": found at ${probe.binPath} but not authenticated; runs may fail until you log in`,
      });
    } else {
      const auth = probe.authenticated === true ? "authenticated" : "auth status unknown";
      messages.push({
        level: "info",
        message: `harness "${probe.name}": ${probe.binPath} (${auth})`,
      });
    }
  }
  return messages;
}
