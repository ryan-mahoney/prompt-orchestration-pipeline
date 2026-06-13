import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { TaskFileIO } from "../core/file-io.ts";
import type { McpServerConnection } from "./types.ts";

export interface McpIoServerHandle {
  connection: McpServerConnection;
  artifactsWritten(): string[];
  close(): Promise<void>;
}

export async function startMcpIoServer(
  io: TaskFileIO,
  opts?: { host?: string },
): Promise<McpIoServerHandle> {
  const host = opts?.host ?? "127.0.0.1";
  const token = randomBytes(32).toString("hex");
  const artifacts: string[] = [];

  function createServerInstance() {
    const srv = new McpServer({
      name: "pop-io-server",
      version: "1.0.0",
    });

    // Casting config + callback: zod v3 generic depth exceeds TS limits with MCP SDK generics.
    // Runtime behavior is correct and tested — the SDK validates input against the zod schema.
    srv.registerTool("write_artifact", {
      description: "Write content to a named artifact file",
      inputSchema: {
        name: z.string().describe("Artifact filename"),
        content: z.string().describe("File content"),
      },
    } as any, (async ({ name, content }: { name: string; content: string }) => {
      await io.writeArtifact(name, content);
      if (!artifacts.includes(name)) {
        artifacts.push(name);
      }
      return { content: [{ type: "text" as const, text: `Wrote artifact: ${name}` }] };
    }) as any);

    srv.registerTool("read_artifact", {
      description: "Read content from a named artifact file",
      inputSchema: {
        name: z.string().describe("Artifact filename"),
      },
    } as any, (async ({ name }: { name: string }) => {
      const content = await io.readArtifact(name);
      return { content: [{ type: "text" as const, text: content }] };
    }) as any);

    srv.registerTool("write_log", {
      description: "Write content to a named log file",
      inputSchema: {
        name: z.string().describe("Log filename"),
        content: z.string().describe("File content"),
      },
    } as any, (async ({ name, content }: { name: string; content: string }) => {
      await io.writeLog(name, content);
      return { content: [{ type: "text" as const, text: `Wrote log: ${name}` }] };
    }) as any);

    srv.registerTool("read_log", {
      description: "Read content from a named log file",
      inputSchema: {
        name: z.string().describe("Log filename"),
      },
    } as any, (async ({ name }: { name: string }) => {
      const content = await io.readLog(name);
      return { content: [{ type: "text" as const, text: content }] };
    }) as any);

    srv.registerTool("write_tmp", {
      description: "Write content to a named temporary file",
      inputSchema: {
        name: z.string().describe("Temp filename"),
        content: z.string().describe("File content"),
      },
    } as any, (async ({ name, content }: { name: string; content: string }) => {
      await io.writeTmp(name, content);
      return { content: [{ type: "text" as const, text: `Wrote tmp: ${name}` }] };
    }) as any);

    srv.registerTool("read_tmp", {
      description: "Read content from a named temporary file",
      inputSchema: {
        name: z.string().describe("Temp filename"),
      },
    } as any, (async ({ name }: { name: string }) => {
      const content = await io.readTmp(name);
      return { content: [{ type: "text" as const, text: content }] };
    }) as any);

    return srv;
  }

  const httpServer = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${token}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    let body: unknown;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const mcpServer = createServerInstance();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, host, () => resolve());
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }
  const port = address.port;

  return {
    connection: {
      url: `http://${host}:${port}/mcp`,
      token,
    },
    artifactsWritten() {
      return [...artifacts];
    },
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
