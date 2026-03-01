import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mocks must be defined before the module is imported
const { mockSpawn, mockSpawnSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockSpawnSync: vi.fn(),
}));

// Mock child_process module
vi.mock("child_process", () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

// Import after mocks are set up
import {
  claudeCodeChat,
  isClaudeCodeAvailable,
} from "../src/providers/claude-code.js";

describe("claude-code provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isClaudeCodeAvailable", () => {
    it("should return true when CLI is installed", () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: "",
        stderr: "",
      });

      const result = isClaudeCodeAvailable();

      expect(result).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith("claude", ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
    });

    it("should return false when CLI is not installed", () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "",
      });

      const result = isClaudeCodeAvailable();

      expect(result).toBe(false);
    });

    it("should return false when spawnSync throws error", () => {
      mockSpawnSync.mockImplementation(() => {
        throw new Error("Command not found");
      });

      const result = isClaudeCodeAvailable();

      expect(result).toBe(false);
    });
  });

  describe("claudeCodeChat", () => {
    it("should spawn CLI with correct args", async () => {
      const mockProc = createMockProcess('{"result": "test response"}');
      mockSpawn.mockReturnValue(mockProc);

      const messages = [{ role: "user", content: "test prompt" }];
      await claudeCodeChat({ messages, model: "sonnet" });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        [
          "-p",
          "test prompt",
          "--output-format",
          "json",
          "--model",
          "sonnet",
          "--max-turns",
          "1",
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    });

    it("should parse JSON response from CLI", async () => {
      const responseData = { result: "test response", session_id: "abc123" };
      const mockProc = createMockProcess(JSON.stringify(responseData));
      mockSpawn.mockReturnValue(mockProc);

      const messages = [{ role: "user", content: "test" }];
      const result = await claudeCodeChat({ messages });

      expect(result.content).toBe("test response");
      expect(result.text).toBe("test response");
      expect(result.raw).toEqual(responseData);
      expect(result.usage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    });

    it("should handle CLI error with stderr", async () => {
      const mockProc = createMockProcess("", "Authentication failed", 1);
      mockSpawn.mockReturnValue(mockProc);

      const messages = [{ role: "user", content: "test" }];

      await expect(claudeCodeChat({ messages })).rejects.toThrow(
        "claude CLI exited with code 1: Authentication failed"
      );
    });

    it("should retry on retryable error", async () => {
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails with network error
          return createMockProcess("", "ECONNRESET", 1);
        }
        // Second call succeeds
        return createMockProcess('{"result": "success after retry"}');
      });

      const messages = [{ role: "user", content: "test" }];
      const result = await claudeCodeChat({ messages, maxRetries: 3 });

      expect(result.content).toBe("success after retry");
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it("should pass system prompt via flag", async () => {
      const mockProc = createMockProcess('{"result": "response"}');
      mockSpawn.mockReturnValue(mockProc);

      const messages = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" },
      ];
      await claudeCodeChat({ messages });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "--system-prompt",
          "You are a helpful assistant",
        ]),
        expect.any(Object)
      );
    });

    it("should pass maxTokens via flag", async () => {
      const mockProc = createMockProcess('{"result": "response"}');
      mockSpawn.mockReturnValue(mockProc);

      const messages = [{ role: "user", content: "test" }];
      await claudeCodeChat({ messages, maxTokens: 500 });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--max-tokens", "500"]),
        expect.any(Object)
      );
    });

    it("should handle spawn error", async () => {
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, handler) => {
          if (event === "error") {
            setTimeout(() => handler(new Error("spawn ENOENT")), 0);
          }
        }),
      };
      mockSpawn.mockReturnValue(mockProc);

      const messages = [{ role: "user", content: "test" }];

      await expect(claudeCodeChat({ messages })).rejects.toThrow(
        "Failed to spawn claude CLI: spawn ENOENT"
      );
    });

    it("should throw ProviderJsonParseError on invalid JSON", async () => {
      const mockProc = createMockProcess("invalid json response");
      mockSpawn.mockReturnValue(mockProc);

      const messages = [{ role: "user", content: "test" }];

      await expect(claudeCodeChat({ messages })).rejects.toThrow(
        "Failed to parse Claude CLI JSON response"
      );
    });

    it("should require JSON response format", async () => {
      const messages = [{ role: "user", content: "test" }];

      await expect(
        claudeCodeChat({ messages, responseFormat: "text" })
      ).rejects.toThrow("only supports JSON response format");
    });
  });
});

/**
 * Helper function to create a mock process that emits data events
 * @param {string} stdout - Data to emit on stdout
 * @param {string} stderr - Data to emit on stderr
 * @param {number} exitCode - Exit code for the process
 * @returns {Object} Mock process object
 */
function createMockProcess(stdout = "", stderr = "", exitCode = 0) {
  const mockProc = {
    stdout: {
      on: vi.fn((event, handler) => {
        if (event === "data" && stdout) {
          setTimeout(() => handler(Buffer.from(stdout)), 0);
        }
      }),
    },
    stderr: {
      on: vi.fn((event, handler) => {
        if (event === "data" && stderr) {
          setTimeout(() => handler(Buffer.from(stderr)), 0);
        }
      }),
    },
    on: vi.fn((event, handler) => {
      if (event === "close") {
        setTimeout(() => handler(exitCode), 10);
      }
    }),
  };
  return mockProc;
}
