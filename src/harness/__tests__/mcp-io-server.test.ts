import { describe, it, expect } from "vitest";
import type { TaskFileIO, WriteOptions } from "../../core/file-io.ts";
import { startMcpIoServer, type McpIoServerHandle } from "../mcp-io-server.ts";

function createFakeIO(): TaskFileIO & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async writeArtifact(name: string, _content: string, _options?: WriteOptions) {
      calls.push(`writeArtifact:${name}`);
    },
    async writeLog(name: string, _content: string, _options?: WriteOptions) {
      calls.push(`writeLog:${name}`);
    },
    async writeTmp(name: string, _content: string, _options?: WriteOptions) {
      calls.push(`writeTmp:${name}`);
    },
    async readArtifact(name: string) {
      calls.push(`readArtifact:${name}`);
      return `artifact-content:${name}`;
    },
    async readLog(name: string) {
      calls.push(`readLog:${name}`);
      return `log-content:${name}`;
    },
    async readTmp(name: string) {
      calls.push(`readTmp:${name}`);
      return `tmp-content:${name}`;
    },
    getTaskDir() {
      return "/fake/task/dir";
    },
    writeLogSync() {},
    getCurrentStage() {
      return "test";
    },
    getDB() {
      throw new Error("not implemented");
    },
    async runBatch() {
      throw new Error("not implemented");
    },
  };
}

function mcpJsonRpc(toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };
}

async function postMcp(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function initializeSession(url: string, token: string) {
  const resp = await postMcp(
    url,
    {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    },
    { Authorization: `Bearer ${token}` },
  );
  expect(resp.status).toBe(200);
}

describe("startMcpIoServer", () => {
  it("write_artifact with correct token invokes io.writeArtifact and appears in artifactsWritten()", async () => {
    const io = createFakeIO();
    const handle = await startMcpIoServer(io);
    try {
      await initializeSession(handle.connection.url, handle.connection.token);

      const resp = await postMcp(
        handle.connection.url,
        mcpJsonRpc("write_artifact", { name: "output.md", content: "hello" }),
        { Authorization: `Bearer ${handle.connection.token}` },
      );
      expect(resp.status).toBe(200);
      expect(io.calls).toContain("writeArtifact:output.md");
      expect(handle.artifactsWritten()).toContain("output.md");
    } finally {
      await handle.close();
    }
  });

  it("read_log with correct token invokes io.readLog and returns content", async () => {
    const io = createFakeIO();
    const handle = await startMcpIoServer(io);
    try {
      await initializeSession(handle.connection.url, handle.connection.token);

      const resp = await postMcp(
        handle.connection.url,
        mcpJsonRpc("read_log", { name: "agent-debug.log" }),
        { Authorization: `Bearer ${handle.connection.token}` },
      );
      const body = await resp.text();

      expect(resp.status).toBe(200);
      expect(io.calls).toContain("readLog:agent-debug.log");
      expect(body).toContain("log-content:agent-debug.log");
    } finally {
      await handle.close();
    }
  });

  it("missing token returns 401 and does not touch io", async () => {
    const io = createFakeIO();
    const handle = await startMcpIoServer(io);
    try {
      const resp = await postMcp(
        handle.connection.url,
        mcpJsonRpc("write_artifact", { name: "x.md", content: "y" }),
      );
      expect(resp.status).toBe(401);
      expect(io.calls).toHaveLength(0);
    } finally {
      await handle.close();
    }
  });

  it("wrong token returns 401 and does not touch io", async () => {
    const io = createFakeIO();
    const handle = await startMcpIoServer(io);
    try {
      const resp = await postMcp(
        handle.connection.url,
        mcpJsonRpc("write_artifact", { name: "x.md", content: "y" }),
        { Authorization: "Bearer wrong-token" },
      );
      expect(resp.status).toBe(401);
      expect(io.calls).toHaveLength(0);
    } finally {
      await handle.close();
    }
  });

  it("bound address is 127.0.0.1", async () => {
    const io = createFakeIO();
    const handle = await startMcpIoServer(io);
    try {
      expect(handle.connection.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    } finally {
      await handle.close();
    }
  });

  it("close() stops the listener", async () => {
    const io = createFakeIO();
    const handle = await startMcpIoServer(io);
    const url = handle.connection.url;
    await handle.close();
    await expect(postMcp(url, { jsonrpc: "2.0", id: 1, method: "ping" })).rejects.toThrow();
  });
});
