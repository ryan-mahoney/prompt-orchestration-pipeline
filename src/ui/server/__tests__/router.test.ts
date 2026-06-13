import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initPATHS, resetPATHS } from "../config-bridge-node";
import { createRouter } from "../router";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "router-XXXXXX")}`.text();
  const trimmed = root.trim();
  tempRoots.push(trimmed);
  return trimmed;
}

afterEach(async () => {
  resetPATHS();
  await Promise.all(tempRoots.splice(0).map((root) => Bun.$`rm -rf ${root}`));
});

describe("router", () => {
  it("dispatches routes and falls back to spa assets", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    await mkdir(path.join(root, "pipeline-data", "current", "job-1"), { recursive: true });
    await writeFile(path.join(root, "pipeline-data", "current", "job-1", "tasks-status.json"), '{"id":"job-1","tasks":{}}');
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.html"), "<html>ok</html>");
    const router = createRouter({ dataDir: root, distDir: path.join(root, "dist") });

    const apiResponse = await router.handle(new Request("http://localhost/api/jobs/job-1", { headers: { Host: "localhost" } }));
    expect(apiResponse.status).toBe(200);

    const spaResponse = await router.handle(new Request("http://localhost/unknown", { headers: { Host: "localhost" } }));
    await expect(spaResponse.text()).resolves.toContain("<html>ok</html>");
  });

  it("dispatches gate decisions to the current job endpoint", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    await mkdir(path.join(root, "pipeline-data", "current", "gate-job"), { recursive: true });
    await writeFile(path.join(root, "pipeline-data", "current", "gate-job", "tasks-status.json"), JSON.stringify({
      id: "gate-job",
      state: "waiting",
      current: "plan",
      currentStage: null,
      lastUpdated: "2026-04-01T10:00:00.000Z",
      tasks: { plan: { state: "done" }, implement: { state: "pending" } },
      files: { artifacts: [], logs: [], tmp: [] },
      gate: {
        afterTask: "plan",
        message: "Review the plan",
        requestedAt: "2026-04-01T10:00:00.000Z",
      },
    }));
    const router = createRouter({ dataDir: root, distDir: path.join(root, "dist") });

    const response = await router.handle(new Request("http://localhost/api/jobs/gate-job/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ action: "reject" }),
    }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ ok: true, jobId: "gate-job", action: "reject", spawned: false });
  });
});

describe("router CORS and hardening", () => {
  it("includes no Access-Control headers when cors is not configured (AC-1)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    const router = createRouter({ dataDir: root, distDir: path.join(root, "dist") });

    const response = await router.handle(new Request("http://localhost/api/state", { headers: { Host: "localhost" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toBeNull();
  });

  it("returns 204 preflight with method/header allowances for OPTIONS /api/* (AC-5)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    const router = createRouter({
      dataDir: root,
      distDir: path.join(root, "dist"),
      cors: { origins: ["https://app.example"], allowNullOrigin: false },
    });

    const response = await router.handle(new Request("http://localhost/api/jobs", {
      method: "OPTIONS",
      headers: { Host: "localhost", Origin: "https://app.example" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("omits ACAO on preflight when origin is not allowed (AC-5)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    const router = createRouter({
      dataDir: root,
      distDir: path.join(root, "dist"),
      cors: { origins: ["https://app.example"], allowNullOrigin: false },
    });

    const response = await router.handle(new Request("http://localhost/api/jobs", {
      method: "OPTIONS",
      headers: { Host: "localhost", Origin: "https://evil.example" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("decorates SSE response with CORS headers and preserves ReadableStream body (AC-6)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    const router = createRouter({
      dataDir: root,
      distDir: path.join(root, "dist"),
      cors: { origins: ["https://app.example"], allowNullOrigin: false },
    });

    router.addRoute("GET", "/api/test-stream", () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const response = await router.handle(new Request("http://localhost/api/test-stream", {
      headers: { Host: "localhost", Origin: "https://app.example" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.body).toBeInstanceOf(ReadableStream);
  });

  it("rejects request with non-loopback Host (AC-7)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    const router = createRouter({ dataDir: root, distDir: path.join(root, "dist") });

    const response = await router.handle(new Request("http://evil.com/api/state"));
    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, code: "forbidden_host" });
  });

  it("rejects request with no Host header (AC-7)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    const router = createRouter({ dataDir: root, distDir: path.join(root, "dist") });

    const req = new Request("http://localhost/api/state");
    const headers = new Headers(req.headers);
    headers.delete("host");
    const reqNoHost = new Request(req.url, { headers });
    const response = await router.handle(reqNoHost);
    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, code: "forbidden_host" });
  });

  it("rejects cross-origin POST with disallowed origin (AC-8)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    const router = createRouter({
      dataDir: root,
      distDir: path.join(root, "dist"),
      cors: { origins: ["https://app.example"], allowNullOrigin: false },
    });

    const response = await router.handle(new Request("http://localhost/api/jobs/x/restart", {
      method: "POST",
      headers: { Host: "localhost", Origin: "https://evil.example" },
    }));
    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, code: "forbidden_origin" });
  });

  it("allows POST with no Origin header (AC-9)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    await mkdir(path.join(root, "pipeline-data", "current", "job-1"), { recursive: true });
    await writeFile(path.join(root, "pipeline-data", "current", "job-1", "tasks-status.json"), '{"id":"job-1","tasks":{}}');
    const router = createRouter({
      dataDir: root,
      distDir: path.join(root, "dist"),
      cors: { origins: ["https://app.example"], allowNullOrigin: false },
    });

    const response = await router.handle(new Request("http://localhost/api/jobs/job-1/restart", {
      method: "POST",
      headers: { Host: "localhost" },
    }));
    expect(response.status).not.toBe(403);
  });

  it("allows same-origin POST with empty allowlist (AC-10)", async () => {
    const root = await makeTempRoot();
    process.env["PO_ROOT"] = root;
    initPATHS(root);
    await mkdir(path.join(root, "pipeline-data", "current", "job-1"), { recursive: true });
    await writeFile(path.join(root, "pipeline-data", "current", "job-1", "tasks-status.json"), '{"id":"job-1","tasks":{}}');
    const router = createRouter({
      dataDir: root,
      distDir: path.join(root, "dist"),
      cors: { origins: [], allowNullOrigin: false },
    });

    const response = await router.handle(new Request("http://localhost/api/jobs/job-1/restart", {
      method: "POST",
      headers: { Host: "localhost", Origin: "http://localhost" },
    }));
    expect(response.status).not.toBe(403);
  });
});
