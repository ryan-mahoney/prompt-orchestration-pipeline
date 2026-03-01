#!/usr/bin/env bun
// Thin wrapper - delegates to the hidden CLI _start-orchestrator command.
// Kept for backward compatibility with any external scripts that reference this path.
import { startOrchestrator } from "../core/orchestrator.js";

const root = process.env.PO_ROOT;
if (!root) {
  console.error("PO_ROOT environment variable is required.");
  process.exit(1);
}

const { stop } = await startOrchestrator({ dataDir: root });

process.on("SIGINT", async () => {
  await stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await stop();
  process.exit(0);
});
