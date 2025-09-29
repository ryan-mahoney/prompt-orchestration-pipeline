// environment.test.js
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mockEnvVars } from "./test-utils.js";

// Mock the modules using vi.hoisted for proper hoisting
const config = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn());
const join = vi.hoisted(() => vi.fn((...args) => args.join("/")));

// Mock the modules
vi.mock("dotenv", () => ({ config }));
vi.mock("node:fs", () => ({ default: { existsSync } }));
vi.mock("node:path", () => ({ default: { join } }));

// Import the module under test after mocks are set up
const { loadEnvironment, validateEnvironment, getEnvironmentConfig } =
  await import("../src/core/environment.js");

describe("Environment Module", () => {
  let cleanupEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupEnv = mockEnvVars({});
  });

  afterEach(() => {
    cleanupEnv();
    vi.restoreAllMocks();
  });

  describe("loadEnvironment", () => {
    it("should load environment files from default locations", async () => {
      // Arrange
      existsSync.mockReturnValue(true);

      // Act
      const result = await loadEnvironment();

      // Assert
      expect(existsSync).toHaveBeenCalledWith(expect.stringContaining("/.env"));
      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining("/.env.local")
      );
      expect(config).toHaveBeenCalledWith({
        path: expect.any(String),
        override: true,
      });
      expect(result.loaded).toContain(".env");
      expect(result.loaded).toContain(".env.local");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("config");
    });

    it("should respect custom rootDir option", async () => {
      // Arrange
      existsSync.mockReturnValue(true);
      const customRootDir = "/custom/path";

      // Act
      await loadEnvironment({ rootDir: customRootDir });

      // Assert
      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining("/custom/path/.env")
      );
      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining("/custom/path/.env.local")
      );
    });

    it("should respect custom envFiles option", async () => {
      // Arrange
      existsSync.mockReturnValue(true);
      const customEnvFiles = [".env.test", ".env.production"];

      // Act
      const result = await loadEnvironment({ envFiles: customEnvFiles });

      // Assert
      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining("/.env.test")
      );
      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining("/.env.production")
      );
      expect(result.loaded).toContain(".env.test");
      expect(result.loaded).toContain(".env.production");
    });

    it("should handle missing environment files gracefully", async () => {
      // Arrange
      existsSync.mockReturnValue(false);

      // Act
      const result = await loadEnvironment();

      // Assert
      expect(existsSync).toHaveBeenCalled();
      expect(config).not.toHaveBeenCalled();
      expect(result.loaded).toEqual([]);
    });

    it("should return warnings from validation", async () => {
      // Arrange
      existsSync.mockReturnValue(true);
      cleanupEnv = mockEnvVars({}); // No API keys

      // Act
      const result = await loadEnvironment();

      // Assert
      expect(result.warnings).toContain(
        "No LLM API keys found in environment."
      );
    });

    it("should return environment config", async () => {
      // Arrange
      existsSync.mockReturnValue(true);
      cleanupEnv = mockEnvVars({
        OPENAI_API_KEY: "test-openai-key",
        ANTHROPIC_API_KEY: "test-anthropic-key",
      });

      // Act
      const result = await loadEnvironment();

      // Assert
      expect(result.config).toMatchObject({
        openai: { apiKey: "test-openai-key" },
        anthropic: { apiKey: "test-anthropic-key" },
      });
    });

    it("should override existing environment variables", async () => {
      // Arrange
      existsSync.mockReturnValue(true);

      // Act
      await loadEnvironment();

      // Assert
      expect(config).toHaveBeenCalledWith({
        path: expect.any(String),
        override: true,
      });
    });
  });

  describe("validateEnvironment", () => {
    it("should return warnings when no LLM API keys found", () => {
      // Arrange
      cleanupEnv = mockEnvVars({}); // No API keys

      // Act
      const warnings = validateEnvironment();

      // Assert
      expect(warnings).toContain("No LLM API keys found in environment.");
    });

    it("should return empty warnings when at least one API key exists", () => {
      // Arrange
      cleanupEnv = mockEnvVars({
        OPENAI_API_KEY: "test-key",
      });

      // Act
      const warnings = validateEnvironment();

      // Assert
      expect(warnings).toEqual([]);
    });

    it("should check for common LLM API keys", () => {
      // Arrange
      cleanupEnv = mockEnvVars({
        OPENAI_API_KEY: "openai-key",
        ANTHROPIC_API_KEY: "anthropic-key",
        DEEPSEEK_API_KEY: "deepseek-key",
        GEMINI_API_KEY: "gemini-key",
      });

      // Act
      const warnings = validateEnvironment();

      // Assert
      expect(warnings).toEqual([]);
    });

    it("should return empty array when multiple API keys exist", () => {
      // Arrange
      cleanupEnv = mockEnvVars({
        OPENAI_API_KEY: "openai-key",
        ANTHROPIC_API_KEY: "anthropic-key",
      });

      // Act
      const warnings = validateEnvironment();

      // Assert
      expect(warnings).toEqual([]);
    });
  });

  describe("getEnvironmentConfig", () => {
    it("should return complete configuration object structure", () => {
      // Arrange
      cleanupEnv = mockEnvVars({
        OPENAI_API_KEY: "openai-key",
        OPENAI_ORGANIZATION: "openai-org",
        OPENAI_BASE_URL: "openai-base",
        ANTHROPIC_API_KEY: "anthropic-key",
        ANTHROPIC_BASE_URL: "anthropic-base",
        DEEPSEEK_API_KEY: "deepseek-key",
        GEMINI_API_KEY: "gemini-key",
        GEMINI_BASE_URL: "gemini-base",
      });

      // Act
      const config = getEnvironmentConfig();

      // Assert
      expect(config).toEqual({
        openai: {
          apiKey: "openai-key",
          organization: "openai-org",
          baseURL: "openai-base",
        },
        anthropic: {
          apiKey: "anthropic-key",
          baseURL: "anthropic-base",
        },
        deepseek: {
          apiKey: "deepseek-key",
        },
        gemini: {
          apiKey: "gemini-key",
          baseURL: "gemini-base",
        },
      });
    });

    it("should handle missing environment variables", () => {
      // Arrange
      cleanupEnv = mockEnvVars({
        OPENAI_API_KEY: "openai-key",
        // Other keys missing
      });

      // Act
      const config = getEnvironmentConfig();

      // Assert
      expect(config.openai.apiKey).toBe("openai-key");
      expect(config.openai.organization).toBeUndefined();
      expect(config.openai.baseURL).toBeUndefined();
      expect(config.anthropic.apiKey).toBeUndefined();
      expect(config.deepseek.apiKey).toBeUndefined();
      expect(config.gemini.apiKey).toBeUndefined();
    });

    it("should include all provider configurations even when empty", () => {
      // Arrange
      cleanupEnv = mockEnvVars({}); // No environment variables

      // Act
      const config = getEnvironmentConfig();

      // Assert
      expect(config).toHaveProperty("openai");
      expect(config).toHaveProperty("anthropic");
      expect(config).toHaveProperty("deepseek");
      expect(config).toHaveProperty("gemini");
      expect(config.openai.apiKey).toBeUndefined();
      expect(config.anthropic.apiKey).toBeUndefined();
      expect(config.deepseek.apiKey).toBeUndefined();
      expect(config.gemini.apiKey).toBeUndefined();
    });

    it("should map environment variables to config properties correctly", () => {
      // Arrange
      cleanupEnv = mockEnvVars({
        OPENAI_API_KEY: "test-openai",
        ANTHROPIC_API_KEY: "test-anthropic",
        DEEPSEEK_API_KEY: "test-deepseek",
        GEMINI_API_KEY: "test-gemini",
      });

      // Act
      const config = getEnvironmentConfig();

      // Assert
      expect(config.openai.apiKey).toBe("test-openai");
      expect(config.anthropic.apiKey).toBe("test-anthropic");
      expect(config.deepseek.apiKey).toBe("test-deepseek");
      expect(config.gemini.apiKey).toBe("test-gemini");
    });
  });
});
