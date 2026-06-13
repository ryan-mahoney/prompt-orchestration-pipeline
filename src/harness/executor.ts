import type { HarnessDescriptor } from "./types.ts";
import { runJsonlSubprocess } from "./subprocess.ts";
import { binEnvVar, harnessBinName, healedPath, resolveHarnessBinary } from "./resolve.ts";
import type {
  HarnessEvent,
  HarnessName,
  HarnessRunOptions,
  HarnessRunResult,
} from "./types.ts";

const DEFAULT_TIMEOUT = 300_000;

export type DescriptorMap = Record<HarnessName, HarnessDescriptor>;

/** True when a spawn failure looks like the executable could not be found. */
function isMissingBinaryError(err: unknown): boolean {
  if (err && typeof err === "object") {
    if ((err as { code?: unknown }).code === "ENOENT") return true;
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.includes("ENOENT")) return true;
  }
  return false;
}

export async function runHarnessTask(
  options: HarnessRunOptions,
  deps?: {
    runJsonlSubprocess?: typeof runJsonlSubprocess;
    descriptors?: DescriptorMap;
    resolveBinary?: typeof resolveHarnessBinary;
  },
): Promise<HarnessRunResult> {
  const descriptors = deps?.descriptors ?? (await import("./descriptors/index.ts")).DESCRIPTORS;
  const descriptor = descriptors[options.harness];
  const resolveBinary = deps?.resolveBinary ?? resolveHarnessBinary;

  // Resolve the CLI to an absolute path so it runs regardless of how POP was launched.
  // When resolution fails, keep the bare command and let the healed PATH below find it.
  const binPath = resolveBinary(descriptor);
  const builtArgv = descriptor.buildArgv(options);
  const argv = binPath ? [binPath, ...builtArgv.slice(1)] : builtArgv;

  const built = descriptor.buildEnv(options);
  const tmpFiles = built.tmpFiles;
  const env = { ...built.env, PATH: healedPath(descriptor.binDirs ?? []) };

  const writtenPaths: string[] = [];
  try {
    if (tmpFiles) {
      for (const tmp of tmpFiles) {
        await Bun.write(tmp.path, tmp.content);
        writtenPaths.push(tmp.path);
      }
    }

    const subprocess = deps?.runJsonlSubprocess ?? runJsonlSubprocess;
    let result;
    try {
      result = await subprocess({
        argv,
        env,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
        signal: options.signal,
      });
    } catch (err) {
      if (binPath === null && isMissingBinaryError(err)) {
        const searched = (descriptor.binDirs ?? []).join(", ") || "no extra install dirs";
        throw new Error(
          `Harness "${options.harness}" CLI "${harnessBinName(descriptor)}" not found. ` +
            `Searched PATH and ${searched}. ` +
            `Install it or set ${binEnvVar(options.harness)} to its absolute path.`,
        );
      }
      throw err;
    }

    if (result.timedOut) {
      throw new Error(
        `Harness "${options.harness}" timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT}ms${result.stderr ? `: ${result.stderr}` : ""}`,
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `Harness "${options.harness}" exited with code ${result.exitCode}${result.stderr ? `: ${result.stderr}` : ""}`,
      );
    }

    const events = descriptor.parseEvents(result.events);

    if (options.onEvent) {
      for (const event of events) {
        options.onEvent(event);
      }
    }

    const finalMessage = descriptor.extractFinalMessage(events);
    const usage = descriptor.extractUsage(events);
    const costUsd = descriptor.extractCostUsd(events);
    const sessionId = descriptor.extractSessionId(events);

    return {
      finalMessage,
      sessionId,
      usage,
      costUsd,
      events,
      exitCode: result.exitCode,
    };
  } finally {
    for (const path of writtenPaths) {
      await Bun.file(path).delete().catch(() => {});
    }
  }
}

export async function isHarnessAvailable(harness: HarnessName, descriptors?: DescriptorMap): Promise<boolean> {
  const desc = descriptors ?? (await import("./descriptors/index.ts")).DESCRIPTORS;
  const descriptor = desc[harness];
  const result = Bun.spawnSync([...descriptor.versionArgv], {
    timeout: 5000,
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, PATH: healedPath(descriptor.binDirs ?? []) },
  });
  return result.exitCode === 0;
}
