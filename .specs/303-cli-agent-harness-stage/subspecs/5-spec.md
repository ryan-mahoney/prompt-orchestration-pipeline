# Step 5: MCP IO Server — COMPLETE

## Target files

- `package.json` — added `@modelcontextprotocol/sdk@^1.29.0` dependency
- `src/harness/mcp-io-server.ts` — new module
- `src/harness/__tests__/mcp-io-server.test.ts` — new test file

## Implementation notes

- The MCP SDK v1.x uses `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` and `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`.
- `McpServer.connect()` can only be called once per instance, so a fresh `McpServer` is created per HTTP request (stateless pattern).
- Zod v3 types cause `TS2589` (excessive depth) with MCP SDK generics. Tool registrations use `as any` casts — runtime behavior is validated by tests.
- Token enforcement happens at the HTTP level (Node.js `http.createServer`) before the request reaches the MCP transport.

## Test results

```
5 pass, 0 fail, 10 expect() calls
```
