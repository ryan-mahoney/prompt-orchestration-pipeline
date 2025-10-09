#!/usr/bin/env node
/**
 * Dev smoke script for single-process Vite + API server
 *
 * Performs automated sanity checks described in docs/project-unify-dev-server.md step 8:
 *  - Starts the server in development mode (Vite middleware)
 *  - GET /  -> expect 200 + text/html
 *  - GET /api/state -> expect JSON equal to state.getState()
 *  - GET /api/events -> expect Content-Type: text/event-stream and initial "event: state"
 *  - Cleanly shuts down the server
 *
 * Exit codes:
 *  0 = success, non-zero = failure
 */

import http from "http";
import { setTimeout as delay } from "timers/promises";
import { startServer } from "../src/ui/server.js";
import * as state from "../src/ui/state.js";

process.env.NODE_ENV = process.env.NODE_ENV || "development";

function httpGetRaw(path, baseUrl, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(path, baseUrl);
      const req = http.get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      });

      req.on("error", (err) => reject(err));
      req.setTimeout(timeout, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
    } catch (err) {
      reject(err);
    }
  });
}

function readSSEInitial(baseUrl, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL("/api/events", baseUrl);
      const req = http.get(url, (res) => {
        const contentType = res.headers["content-type"] || "";
        if (!contentType.includes("text/event-stream")) {
          req.destroy();
          reject(
            new Error(
              `Unexpected content-type for SSE: ${contentType || "<none>"}`
            )
          );
          return;
        }

        let buffer = "";
        const timer = setTimeout(() => {
          req.destroy();
          reject(new Error("SSE read timeout"));
        }, timeout);

        res.on("data", (chunk) => {
          buffer += chunk.toString();
          // Wait for the initial 'event: state' payload
          if (buffer.includes("event: state")) {
            clearTimeout(timer);
            // Close connection; we only needed the initial payload
            req.destroy();
            resolve(buffer);
          }
        });

        res.on("end", () => {
          clearTimeout(timer);
          // If stream ended before we saw event: state
          if (!buffer.includes("event: state")) {
            reject(new Error("SSE stream ended before initial state event"));
          }
        });
      });

      req.on("error", (err) => reject(err));
      req.setTimeout(timeout, () => {
        req.destroy();
        reject(new Error("SSE connection timeout"));
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function run() {
  console.log("Dev smoke: starting server in development mode...");
  let srv;
  try {
    srv = await startServer({ port: 0 }); // ephemeral port
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(2);
  }

  console.log("Server started at:", srv.url);

  try {
    // Give Vite a short moment to warm up if needed
    await delay(200);

    console.log("Checking GET / ...");
    const rootResp = await httpGetRaw("/", srv.url);
    if (rootResp.statusCode !== 200) {
      throw new Error(`GET / returned status ${rootResp.statusCode}`);
    }
    const ct = rootResp.headers["content-type"] || "";
    if (!ct.includes("text/html")) {
      throw new Error(`GET / content-type not HTML: ${ct}`);
    }
    console.log("GET / OK (200 + text/html)");

    console.log("Checking GET /api/state ...");
    const stateResp = await httpGetRaw("/api/state", srv.url);
    if (stateResp.statusCode !== 200) {
      throw new Error(`/api/state returned status ${stateResp.statusCode}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(stateResp.body);
    } catch (err) {
      throw new Error(`/api/state returned invalid JSON: ${err.message}`);
    }

    const expected = state.getState();
    // Basic deep equality check via JSON serialization (sufficient for smoke)
    if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
      throw new Error(
        `/api/state payload does not match state.getState().\nGot: ${JSON.stringify(
          parsed
        )}\nExpected: ${JSON.stringify(expected)}`
      );
    }
    console.log("GET /api/state OK (JSON matches state.getState())");

    console.log("Checking GET /api/events (SSE initial state) ...");
    const sseData = await readSSEInitial(srv.url, { timeout: 5000 });
    if (!sseData.includes("event: state")) {
      throw new Error("SSE initial payload did not contain 'event: state'");
    }
    console.log("GET /api/events OK (initial 'event: state' received)");

    console.log("All checks passed — shutting down server...");
    await srv.close();
    console.log("Server shut down cleanly");
    process.exit(0);
  } catch (err) {
    console.error("Dev smoke failed:", err);
    try {
      if (srv && typeof srv.close === "function") {
        await srv.close();
      }
    } catch (closeErr) {
      console.error("Error during shutdown:", closeErr);
    }
    process.exit(3);
  }
}

run();
