/**
 * Unit tests for SSE Registry functionality (Step 3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSSERegistry } from "../src/ui/sse.js";

describe("SSE Registry (Step 3)", () => {
  let sseRegistry;
  let mockResponse1;
  let mockResponse2;

  beforeEach(() => {
    sseRegistry = createSSERegistry();

    // Create mock response objects
    mockResponse1 = {
      write: vi.fn(),
      end: vi.fn(),
    };

    mockResponse2 = {
      write: vi.fn(),
      end: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("addClient", () => {
    it("should add a client to the registry", () => {
      sseRegistry.addClient(mockResponse1);
      expect(sseRegistry.getClientCount()).toBe(1);
    });

    it("should add multiple clients to the registry", () => {
      sseRegistry.addClient(mockResponse1);
      sseRegistry.addClient(mockResponse2);
      expect(sseRegistry.getClientCount()).toBe(2);
    });
  });

  describe("removeClient", () => {
    it("should remove a client from the registry", () => {
      sseRegistry.addClient(mockResponse1);
      sseRegistry.addClient(mockResponse2);
      expect(sseRegistry.getClientCount()).toBe(2);

      sseRegistry.removeClient(mockResponse1);
      expect(sseRegistry.getClientCount()).toBe(1);
    });

    it("should handle removing non-existent client gracefully", () => {
      sseRegistry.addClient(mockResponse1);
      expect(sseRegistry.getClientCount()).toBe(1);

      sseRegistry.removeClient(mockResponse2); // Not added
      expect(sseRegistry.getClientCount()).toBe(1);
    });
  });

  describe("broadcast", () => {
    it("should broadcast event to all connected clients", () => {
      sseRegistry.addClient(mockResponse1);
      sseRegistry.addClient(mockResponse2);

      const testEvent = {
        type: "test-event",
        data: { message: "test message" },
      };

      sseRegistry.broadcast(testEvent);

      expect(mockResponse1.write).toHaveBeenCalledWith("event: test-event\n");
      expect(mockResponse1.write).toHaveBeenCalledWith(
        'data: {"message":"test message"}\n\n'
      );

      expect(mockResponse2.write).toHaveBeenCalledWith("event: test-event\n");
      expect(mockResponse2.write).toHaveBeenCalledWith(
        'data: {"message":"test message"}\n\n'
      );
    });

    it("should handle broadcast to empty registry", () => {
      const testEvent = {
        type: "test-event",
        data: { message: "test message" },
      };

      // Should not throw when no clients are connected
      expect(() => sseRegistry.broadcast(testEvent)).not.toThrow();
    });

    it("should remove dead clients when write fails", () => {
      // Mock a client that throws on write
      const deadClient = {
        write: vi.fn().mockImplementation(() => {
          throw new Error("Write failed");
        }),
      };

      sseRegistry.addClient(deadClient);
      sseRegistry.addClient(mockResponse1);

      const testEvent = {
        type: "test-event",
        data: { message: "test message" },
      };

      sseRegistry.broadcast(testEvent);

      // Dead client should be removed
      expect(sseRegistry.getClientCount()).toBe(1);
      // Live client should still receive the message
      expect(mockResponse1.write).toHaveBeenCalled();
    });
  });

  describe("broadcast seed:uploaded event", () => {
    it("should broadcast seed:uploaded event with correct format", () => {
      sseRegistry.addClient(mockResponse1);

      const seedUploadEvent = {
        type: "seed:uploaded",
        data: { jobName: "test-job-123" },
      };

      sseRegistry.broadcast(seedUploadEvent);

      expect(mockResponse1.write).toHaveBeenCalledWith(
        "event: seed:uploaded\n"
      );
      expect(mockResponse1.write).toHaveBeenCalledWith(
        'data: {"jobName":"test-job-123"}\n\n'
      );
    });

    it("should match the exact SSE contract requirements", () => {
      sseRegistry.addClient(mockResponse1);

      // Test the exact event format required by the contracts
      const seedUploadEvent = {
        type: "seed:uploaded",
        data: { jobName: "test-job-456" },
      };

      sseRegistry.broadcast(seedUploadEvent);

      // Verify the exact SSE format
      const calls = mockResponse1.write.mock.calls;
      expect(calls[0][0]).toBe("event: seed:uploaded\n");
      expect(calls[1][0]).toBe('data: {"jobName":"test-job-456"}\n\n');
    });
  });

  describe("closeAll", () => {
    it("should close all client connections and clear registry", () => {
      sseRegistry.addClient(mockResponse1);
      sseRegistry.addClient(mockResponse2);

      expect(sseRegistry.getClientCount()).toBe(2);

      sseRegistry.closeAll();

      expect(mockResponse1.end).toHaveBeenCalled();
      expect(mockResponse2.end).toHaveBeenCalled();
      expect(sseRegistry.getClientCount()).toBe(0);
    });

    it("should handle closeAll with empty registry", () => {
      expect(sseRegistry.getClientCount()).toBe(0);
      expect(() => sseRegistry.closeAll()).not.toThrow();
    });
  });

  describe("getClientCount", () => {
    it("should return correct client count", () => {
      expect(sseRegistry.getClientCount()).toBe(0);

      sseRegistry.addClient(mockResponse1);
      expect(sseRegistry.getClientCount()).toBe(1);

      sseRegistry.addClient(mockResponse2);
      expect(sseRegistry.getClientCount()).toBe(2);

      sseRegistry.removeClient(mockResponse1);
      expect(sseRegistry.getClientCount()).toBe(1);

      sseRegistry.removeClient(mockResponse2);
      expect(sseRegistry.getClientCount()).toBe(0);
    });
  });
});
