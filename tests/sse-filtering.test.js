/**
 * Tests for SSE filtering by jobId functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSSERegistry } from "../src/ui/sse.js";

describe("SSE Registry Job Filtering", () => {
  let registry;
  let mockClients;

  beforeEach(() => {
    registry = createSSERegistry({ heartbeatMs: 100, sendInitialPing: false });
    mockClients = [];
  });

  afterEach(() => {
    registry.closeAll();
    mockClients.forEach((client) => {
      try {
        client.end?.();
      } catch {}
    });
  });

  function createMockClient() {
    const events = [];
    const mockRes = {
      write: vi.fn((data) => {
        events.push(data);
      }),
      writeHead: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    mockClients.push(mockRes);
    return mockRes;
  }

  describe("Client Management with JobId", () => {
    it("should add client with jobId metadata", () => {
      const mockRes = createMockClient();

      registry.addClient(mockRes, { jobId: "job-123" });

      expect(registry.getClientCount()).toBe(1);
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
    });

    it("should add client without jobId (backward compatibility)", () => {
      const mockRes = createMockClient();

      registry.addClient(mockRes);

      expect(registry.getClientCount()).toBe(1);
    });

    it("should remove client by response object", () => {
      const mockRes = createMockClient();

      registry.addClient(mockRes, { jobId: "job-123" });
      expect(registry.getClientCount()).toBe(1);

      registry.removeClient(mockRes);
      expect(registry.getClientCount()).toBe(0);
    });
  });

  describe("Event Filtering Logic", () => {
    it("should send events to all clients when data has no id", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();

      registry.addClient(client1, { jobId: "job-1" });
      registry.addClient(client2, { jobId: "job-2" });

      registry.broadcast({ type: "test", data: { message: "no id" } });

      expect(client1.write).toHaveBeenCalled();
      expect(client2.write).toHaveBeenCalled();
    });

    it("should send events to matching jobId clients only", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const client3 = createMockClient();

      registry.addClient(client1, { jobId: "job-1" });
      registry.addClient(client2, { jobId: "job-2" });
      registry.addClient(client3); // No jobId

      registry.broadcast({
        type: "job:updated",
        data: { id: "job-1", status: "running" },
      });

      expect(client1.write).toHaveBeenCalled();
      expect(client2.write).not.toHaveBeenCalled();
      expect(client3.write).toHaveBeenCalled(); // No jobId = receives all
    });

    it("should send events to clients without jobId (backward compatibility)", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();

      registry.addClient(client1, { jobId: "job-1" });
      registry.addClient(client2); // No jobId

      registry.broadcast({
        type: "job:updated",
        data: { id: "different-job", status: "running" },
      });

      expect(client1.write).not.toHaveBeenCalled();
      expect(client2.write).toHaveBeenCalled(); // No jobId = receives all
    });

    it("should handle string event format", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();

      registry.addClient(client1, { jobId: "job-1" });
      registry.addClient(client2, { jobId: "job-2" });

      registry.broadcast("job:updated", { id: "job-1", status: "running" });

      expect(client1.write).toHaveBeenCalled();
      expect(client2.write).not.toHaveBeenCalled();
    });

    it("should handle untyped event format", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();

      registry.addClient(client1, { jobId: "job-1" });
      registry.addClient(client2, { jobId: "job-2" });

      registry.broadcast({ id: "job-1", status: "running" });

      expect(client1.write).toHaveBeenCalled();
      expect(client2.write).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle dead clients gracefully", () => {
      const deadClient = {
        write: vi.fn(() => {
          throw new Error("Connection closed");
        }),
        end: vi.fn(),
        on: vi.fn(),
      };

      const aliveClient = createMockClient();

      registry.addClient(deadClient, { jobId: "job-1" });
      registry.addClient(aliveClient, { jobId: "job-2" });

      expect(registry.getClientCount()).toBe(2);

      // Broadcast should remove dead client
      registry.broadcast({ type: "test", data: { id: "job-1" } });

      expect(registry.getClientCount()).toBe(1);
    });
  });

  describe("Backward Compatibility", () => {
    it("should work with old-style clients (direct response objects)", () => {
      const oldStyleClient = createMockClient();
      const newStyleClient = createMockClient();

      // Add old-style client (direct response object)
      registry.addClient(oldStyleClient);

      // Add new-style client (with metadata)
      registry.addClient(newStyleClient, { jobId: "job-1" });

      registry.broadcast({ type: "test", data: { message: "no id" } });

      expect(oldStyleClient.write).toHaveBeenCalled();
      expect(newStyleClient.write).toHaveBeenCalled();
    });

    it("should remove old-style clients correctly", () => {
      const oldStyleClient = createMockClient();

      registry.addClient(oldStyleClient);
      expect(registry.getClientCount()).toBe(1);

      registry.removeClient(oldStyleClient);
      expect(registry.getClientCount()).toBe(0);
    });
  });
});
