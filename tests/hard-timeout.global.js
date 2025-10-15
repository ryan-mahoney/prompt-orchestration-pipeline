/**
 * Global setup for Vitest to enforce a hard timeout and kill hung test runs.
 * Disabled in watch mode to avoid interrupting developers.
 *
 * Environment variable:
 * - VITEST_HARD_TIMEOUT_MS: override the hard timeout in milliseconds (default: 10 minutes)
 */

export default async function globalSetup() {
  const msFromEnv = Number(process.env.VITEST_HARD_TIMEOUT_MS);
  const isWatch =
    process.env.VITEST_MODE === "watch" || process.env.VITEST_WATCH === "true";

  // Default: 10 minutes. Set to 0 to disable (e.g., in watch mode)
  const HARD_TIMEOUT_MS =
    Number.isFinite(msFromEnv) && msFromEnv > 0
      ? msFromEnv
      : isWatch
        ? 0
        : 10 * 60 * 1000;

  let timer;

  if (HARD_TIMEOUT_MS > 0) {
    // eslint-disable-next-line no-console
    console.info(
      `[vitest-hard-timeout] Enabling hard timeout of ${HARD_TIMEOUT_MS} ms`
    );

    timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error(
        `[vitest-hard-timeout] Hard timeout (${HARD_TIMEOUT_MS} ms) reached. ` +
          `Forcing exit to prevent hung test run.`
      );
      // Attempt graceful exit first, then forceful kill
      try {
        process.exitCode = 1;
      } catch {}
      // Fallback: SIGKILL after 2 seconds if graceful exit fails
      setTimeout(() => {
        try {
          process.kill(process.pid, "SIGKILL");
        } catch {}
      }, 2000).unref?.();
      process.exit(1);
    }, HARD_TIMEOUT_MS).unref?.(); // Avoid keeping event loop alive if nothing else is running
  } else {
    // eslint-disable-next-line no-console
    console.info(
      "[vitest-hard-timeout] Hard timeout disabled (watch mode or set to 0)"
    );
  }

  // Teardown: clear timer if tests finish cleanly
  return async () => {
    if (timer) {
      clearTimeout(timer);
    }
  };
}
