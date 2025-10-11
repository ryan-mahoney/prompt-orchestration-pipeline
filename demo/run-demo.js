#!/usr/bin/env node
/**
 * Deprecated demo runner shim.
 *
 * The demo should now use the production server entrypoint with PO_ROOT set
 * to the demo directory. This script remains as a backward-compatible shim
 * that prints a deprecation warning and forwards to the production server.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.warn(
  "Deprecated: demo/run-demo.js is deprecated and will be removed in a future release.\n" +
    "Use `NODE_ENV=production PO_ROOT=demo node src/ui/server.js` to run the demo.\n" +
    "This shim will forward to the production server for now."
);

// Ensure environment defaults for demo parity with production
process.env.PO_ROOT = process.env.PO_ROOT || path.join(__dirname);
process.env.NODE_ENV = process.env.NODE_ENV || "production";

try {
  const mod = await import("../src/ui/server.js");

  // Prefer the async startServer({ dataDir, port }) API when available, since it returns a promise.
  if (mod && typeof mod.startServer === "function") {
    try {
      // Start server with the configured PO_ROOT. startServer keeps process alive.
      await mod.startServer({ dataDir: process.env.PO_ROOT });
    } catch (err) {
      console.error("Failed to start server via startServer():", err);
      process.exit(1);
    }
  } else if (mod && typeof mod.start === "function") {
    try {
      // start() may be synchronous (returns server) or return a promise.
      const result = mod.start();
      if (result && typeof result.then === "function") {
        await result;
      }
      // If it's synchronous, start() already started the server and we just keep the process alive.
    } catch (err) {
      console.error("Failed to start server via start():", err);
      process.exit(1);
    }
  } else {
    console.error(
      "Unable to find an exported start/startServer function in src/ui/server.js. Please run the server directly with PO_ROOT set."
    );
    process.exit(1);
  }
} catch (err) {
  console.error("Error forwarding to src/ui/server.js:", err);
  process.exit(1);
}
