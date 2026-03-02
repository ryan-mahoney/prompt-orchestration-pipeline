import { join } from "node:path";
import type { ReexecArgs } from "./types.ts";

/**
 * Returns true if running as a compiled Bun binary (standalone executable).
 * Bun compiled binaries run from a virtual /$bunfs/ filesystem.
 */
export function isCompiledBinary(): boolean {
  const filePath = (import.meta.path ?? import.meta.url).replace(/\\/g, "/");
  return filePath.includes("/$bunfs/");
}

const CLI_ENTRY = join(import.meta.dir, "index.ts");

/**
 * Construct spawn arguments for self-reexec process model.
 * In compiled binary mode, spawns the binary directly with the command.
 * In source mode, spawns the CLI entry file with the command.
 */
export function buildReexecArgs(command: string[]): ReexecArgs {
  if (isCompiledBinary()) {
    return { execPath: process.execPath, args: [...command] };
  }
  return { execPath: process.execPath, args: [CLI_ENTRY, ...command] };
}
