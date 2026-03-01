import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const CLI_ENTRY = path.resolve(path.dirname(currentFile), "index.js");

/**
 * Detect whether we are running from a compiled Bun binary.
 * In compiled binaries, import.meta.url resolves to Bun's virtual
 * filesystem (/$bunfs/), which doesn't exist on disk.
 */
function isCompiledBinary() {
  return currentFile.startsWith("/$bunfs/");
}

/**
 * Build spawn arguments for re-executing the CLI with a hidden subcommand.
 * Source mode:  [process.execPath, CLI_ENTRY, ...command]
 * Compiled mode: [process.execPath, ...command]
 *
 * @param {string[]} command - Hidden command and its arguments, e.g. ["_run-job", jobId]
 * @returns {{ execPath: string, args: string[] }}
 */
export function buildReexecArgs(command) {
  if (isCompiledBinary()) {
    return { execPath: process.execPath, args: [...command] };
  }
  return { execPath: process.execPath, args: [CLI_ENTRY, ...command] };
}

export { isCompiledBinary };
