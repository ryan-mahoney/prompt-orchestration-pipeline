#!/usr/bin/env node
import { startOrchestrator } from "../core/orchestrator.js";

async function main() {
  const root = process.env.PO_ROOT;

  if (!root) {
    console.error(
      "PO_ROOT environment variable is required. Please set PO_ROOT to your pipeline root directory (e.g., ./demo)."
    );
    process.exit(1);
  }

  try {
    console.log(`Starting orchestrator with dataDir: ${root}`);
    const { stop } = await startOrchestrator({ dataDir: root });

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nReceived SIGINT, shutting down orchestrator...");
      await stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\nReceived SIGTERM, shutting down orchestrator...");
      await stop();
      process.exit(0);
    });
  } catch (error) {
    console.error("Orchestrator failed to start:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in orchestrator runner:", error);
  process.exit(1);
});
