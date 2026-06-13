export interface RunJsonlSubprocessArgs {
  argv: string[];
  env: Record<string, string>;
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RunJsonlSubprocessResult {
  events: unknown[];
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

function parseJsonl(stdout: string): unknown[] {
  const events: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // skip unparseable lines
    }
  }
  return events;
}

export async function runJsonlSubprocess(
  args: RunJsonlSubprocessArgs,
): Promise<RunJsonlSubprocessResult> {
  const { argv, env, cwd, timeoutMs, signal } = args;

  const proc = Bun.spawn(argv, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
    ...(cwd !== undefined ? { cwd } : {}),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  if (signal !== undefined) {
    if (signal.aborted) {
      timedOut = true;
      proc.kill();
    } else {
      signal.addEventListener(
        "abort",
        () => {
          proc.kill();
        },
        { once: true },
      );
    }
  }

  try {
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timer);

    const stderr = await new Response(proc.stderr).text();

    return {
      events: parseJsonl(stdout),
      stdout,
      stderr,
      exitCode: proc.exitCode ?? -1,
      timedOut,
    };
  } catch (err) {
    clearTimeout(timer);
    proc.kill();
    throw err;
  }
}
