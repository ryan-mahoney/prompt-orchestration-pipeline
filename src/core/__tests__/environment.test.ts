import { describe, test, expect, afterEach } from "bun:test";
import { getEnvironmentConfig, validateEnvironment, loadEnvironment } from "../environment";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("getEnvironmentConfig", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns structured credentials from env vars", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_ORG_ID = "org-test";
    const config = getEnvironmentConfig();
    expect(config.openai.apiKey).toBe("sk-test");
    expect(config.openai.organization).toBe("org-test");
  });

  test("returns undefined for unset variables", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const config = getEnvironmentConfig();
    expect(config.openai.apiKey).toBeUndefined();
    expect(config.anthropic.apiKey).toBeUndefined();
  });
});

describe("validateEnvironment", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns warning when no API keys are set", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const warnings = validateEnvironment();
    expect(warnings).toContain("No LLM API keys found in environment.");
  });

  test("returns empty array when at least one key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const warnings = validateEnvironment();
    expect(warnings).toHaveLength(0);
  });
});

describe("loadEnvironment", () => {
  test("loads .env files and returns loaded filenames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "env-test-"));
    await writeFile(join(dir, ".env"), "OPENAI_API_KEY=test-key\n");
    const result = await loadEnvironment({ rootDir: dir });
    expect(result.loaded).toContain(".env");
    expect(result.config.openai.apiKey).toBe("test-key");
    await rm(dir, { recursive: true });
  });

  test("skips missing .env files without error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "env-test-"));
    const result = await loadEnvironment({ rootDir: dir, envFiles: [".env.nonexistent"] });
    expect(result.loaded).toHaveLength(0);
    await rm(dir, { recursive: true });
  });
});
