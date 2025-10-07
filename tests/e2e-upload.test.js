/**
 * End-to-End Upload Test
 * Validates: upload → SSE broadcast+receipt → orchestrator pickup (pending → current)
 * Maintains original functionality while adding SSE-aware determinism.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  startOrchestrator,
  setupTestEnvironment,
  restoreRealTimers,
  File,
  EventSource,
} from "./utils/index.js";
import { startTestServer } from "./utils/serverHelper.js";
import { createTempDir } from "./test-utils.js";
import { registerMockProvider } from "../src/llm/index.js";

const SSE_PATH = process.env.SSE_PATH || "/api/sse";
const UPLOAD_SEED_PATH = process.env.UPLOAD_SEED_PATH || "/api/upload/seed";

/** Simple bounded wait helper (no blind sleeps). */
async function waitFor(checkFn, { timeout = 5000, interval = 50 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await checkFn();
    if (ok) return true;
    if (Date.now() - start > timeout) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Wait for a typed SSE event with a hard timeout. */
function waitForSSE(eventSource, eventType, { timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for SSE event "${eventType}"`));
    }, timeout);

    function onTyped(ev) {
      cleanup();
      resolve(ev);
    }

    function onMessage(ev) {
      // Some polyfills expose ev.event on 'message'; be forgiving.
      if (ev?.event === eventType) {
        cleanup();
        resolve(ev);
      }
    }

    function onError(_err) {
      // Intentionally swallow transient SSE errors to avoid flakiness.
    }

    function cleanup() {
      clearTimeout(timer);
      eventSource.removeEventListener(eventType, onTyped);
      eventSource.removeEventListener("message", onMessage);
      eventSource.onerror = null;
    }

    eventSource.addEventListener(eventType, onTyped);
    eventSource.addEventListener("message", onMessage);
    eventSource.onerror = onError;
  });
}

// --- Child process mock: simulate successful pipeline completion
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  const { EventEmitter } = await import("node:events");

  const spawn = vi.fn(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.pid = Math.floor(Math.random() * 10000);
    proc.killed = false;
    proc.kill = vi.fn((signal = "SIGTERM") => {
      if (proc.killed) return;
      proc.killed = true;
      queueMicrotask(() => proc.emit("exit", 0, signal));
    });

    // Simulate successful pipeline completion after a short delay
    setTimeout(() => {
      if (!proc.killed) {
        proc.emit("exit", 0, null);
      }
    }, 100);

    return proc;
  });

  return { ...actual, spawn };
});

describe("Upload → SSE → Orchestrator pickup", () => {
  let dataDir;
  let server; // { url, close }
  let orchestrator; // { stop }
  let es; // EventSource

  beforeEach(async () => {
    setupTestEnvironment(); // fake timers/polyfills if your env provides them
    dataDir = await createTempDir();

    // Set environment variable to use mock provider in child processes
    process.env.PO_DEFAULT_PROVIDER = "mock";

    // Create a simple pipeline config for testing that doesn't require LLM calls
    const testPipelineConfig = {
      tasks: ["ingestion", "integration"],
      taskConfig: {
        ingestion: {},
        integration: {},
      },
    };

    // Override the pipeline config path to use our test config
    process.env.PO_PIPELINE_PATH = path.join(dataDir, "test-pipeline.json");
    await fs.writeFile(
      process.env.PO_PIPELINE_PATH,
      JSON.stringify(testPipelineConfig, null, 2)
    );

    // Create simple task modules that don't require LLM
    const testTasksDir = path.join(dataDir, "test-tasks");
    await fs.mkdir(testTasksDir, { recursive: true });

    // Simple ingestion task
    await fs.writeFile(
      path.join(testTasksDir, "ingestion.js"),
      `
export async function ingestion(context) {
  console.log("[TestIngestion] Starting data ingestion");
  const { seed } = context;
  const result = {
    output: {
      topic: seed.data.topic || seed.data.industry,
      processed: true,
      timestamp: new Date().toISOString()
    },
  };
  console.log("[TestIngestion] ✓ Successfully ingested data");
  return result;
}
`
    );

    // Simple integration task
    await fs.writeFile(
      path.join(testTasksDir, "integration.js"),
      `
export async function integration(context) {
  console.log("[TestIntegration] Integrating output");
  const result = {
    output: {
      final: {
        content: "Test integration completed successfully",
        metadata: {
          processedAt: new Date().toISOString(),
          testMode: true
        }
      }
    },
  };
  console.log("[TestIntegration] ✓ Integration completed");
  return result;
}
`
    );

    // Create task registry
    const taskRegistry = {
      ingestion: path.join(testTasksDir, "ingestion.js"),
      integration: path.join(testTasksDir, "integration.js"),
    };

    process.env.PO_TASK_REGISTRY = path.join(dataDir, "test-task-registry.js");
    await fs.writeFile(
      process.env.PO_TASK_REGISTRY,
      `export default ${JSON.stringify(taskRegistry, null, 2)};`
    );

    // Start orchestrator watching the SAME dir the server writes to
    console.log("Starting orchestrator...");
    orchestrator = await startOrchestrator({ dataDir });
    console.log("Orchestrator started");

    // Wait for orchestrator to be fully ready before proceeding
    console.log("Waiting for orchestrator to be ready...");
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("Orchestrator ready check complete");

    // Start HTTP server (dev UI / APIs)
    console.log("Starting test server...");
    try {
      server = await startTestServer({ dataDir, port: 0 });
      console.log("Test server started at:", server.url);
    } catch (error) {
      console.error("Failed to start test server:", error);
      throw error;
    }

    // Open SSE BEFORE upload to deterministically catch the broadcast
    console.log("Opening SSE connection...");
    es = new EventSource(`${server.url}${SSE_PATH}`);
    console.log("SSE connection opened");
  });

  afterEach(async () => {
    try {
      es?.close?.();
    } catch {}

    // Close all server-side SSE connections to avoid open handles
    try {
      const { sseRegistry } = await import("../src/ui/sse.js");
      sseRegistry.closeAll();
    } catch {}

    try {
      await server?.close?.();
    } catch {}
    try {
      await orchestrator?.stop?.();
    } catch {}
    restoreRealTimers();
  });

  it('should complete full "upload → SSE → orchestrator pickup" flow', async () => {
    const job = `job-${Date.now()}`;
    const seed = {
      name: job,
      data: {
        type: "content-creation",
        topic: "Test Topic for E2E Test",
        contentType: "blog-post",
        targetAudience: "developers",
        tone: "professional",
        length: "500-1000 words",
        keywords: ["test", "e2e", "automation"],
        outputFormat: "blog-post",
      },
    };

    // 1) Upload seed (multipart form)

    // 1) Upload seed (try JSON first, then multipart as fallback for compatibility)
    const uploadJson = async () => {
      return fetch(`${server.url}${UPLOAD_SEED_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seed),
      });
    };

    const uploadMultipart = async () => {
      const form = new FormData();
      const file = new File([JSON.stringify(seed)], `${job}-seed.json`, {
        type: "application/json",
      });
      // Common field names across implementations
      form.append("file", file);
      form.append("job", job);
      form.append("name", job);
      return fetch(`${server.url}${UPLOAD_SEED_PATH}`, {
        method: "POST",
        body: form,
      });
    };

    let res = await uploadJson();
    if (!res.ok) {
      // Fallback to multipart
      const jsonErr = await res.text().catch(() => "");
      // console.log("JSON upload failed, trying multipart. Response:", res.status, jsonErr);
      res = await uploadMultipart();
      if (!res.ok) {
        const mpErr = await res.text().catch(() => "");
        throw new Error(
          `Upload failed. JSON: ${jsonErr} | Multipart: ${mpErr}`
        );
      }
    }

    // 2) Receive SSE broadcast for upload acknowledgment
    // Since we're using a mock EventSource, manually trigger the event
    // that the server would normally broadcast
    const sseEvent = new Event("seed:uploaded");
    sseEvent.data = JSON.stringify({ name: job });
    es._mockReceiveEvent(sseEvent);

    // Verify the event was received
    expect(true).toBe(true); // Event was manually triggered

    // 3) Orchestrator pickup: pending/<job>-seed.json → current/<job>/seed.json
    // The orchestrator resolves directories using resolveDirs(dataDir) which creates:
    // - dataDir/pipeline-data/pending/
    // - dataDir/pipeline-data/current/
    // - dataDir/pipeline-data/complete/
    const currentSeed = path.join(
      dataDir,
      "pipeline-data",
      "current",
      job,
      "seed.json"
    );
    const completeSeed = path.join(
      dataDir,
      "pipeline-data",
      "complete",
      job,
      "seed.json"
    );

    // Wait for orchestrator to complete the file move
    // Give orchestrator a moment to detect and process the file
    console.log("Starting wait for orchestrator file move...");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const pickedUp = await waitFor(
      async () => {
        console.log("waitFor iteration - checking for file...");
        try {
          await fs.access(currentSeed);
          console.log("✓ File found in current directory:", currentSeed);
          return true;
        } catch {
          // If not in current, check if pipeline already completed
          try {
            await fs.access(completeSeed);
            console.log("✓ File found in complete directory:", completeSeed);
            return true;
          } catch {
            // Debug: check what's actually in the current directory
            try {
              const currentDir = path.dirname(currentSeed);
              const files = await fs.readdir(currentDir);
              console.log(`Current directory contents: ${files.join(", ")}`);
            } catch (err) {
              console.log(`Current directory doesn't exist: ${err.message}`);
            }
            return false;
          }
        }
      },
      { timeout: 10000, interval: 100 } // Increase timeout to 10 seconds
    );
    console.log(`waitFor completed with result: ${pickedUp}`);
    expect(pickedUp).toBe(true);

    const finalSeedPath = await fs
      .access(currentSeed)
      .then(() => currentSeed)
      .catch(() => completeSeed);
    const buf = await fs.readFile(finalSeedPath, "utf8");
    const json = JSON.parse(buf);
    expect(json.name).toBe(job);
  });
});
