import type { HarnessDescriptor } from "./types.ts";
import { runJsonlSubprocess } from "./subprocess.ts";
import type {
  HarnessEvent,
  HarnessName,
  HarnessRunOptions,
  HarnessRunResult,
} from "./types.ts";

const DEFAULT_TIMEOUT = 300_000;

export type DescriptorMap = Record<HarnessName, HarnessDescriptor>;

export async function runHarnessTask(
  options: HarnessRunOptions,
  deps?: { runJsonlSubprocess?: typeof runJsonlSubprocess; descriptors?: DescriptorMap },
): Promise<HarnessRunResult> {
  const descriptors = deps?.descriptors ?? (await import("./descriptors/index.ts")).DESCRIPTORS;
  const descriptor = descriptors[options.harness];
  const argv = descriptor.buildArgv(options);
  const { env, tmpFiles } = descriptor.buildEnv(options);

  const writtenPaths: string[] = [];
  try {
    if (tmpFiles) {
      for (const tmp of tmpFiles) {
        await Bun.write(tmp.path, tmp.content);
        writtenPaths.push(tmp.path);
      }
    }

    const subprocess = deps?.runJsonlSubprocess ?? runJsonlSubprocess;
    const result = await subprocess({
      argv,
      env,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
      signal: options.signal,
    });

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
  });
  return result.exitCode === 0;
}
