import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getDefaultPipelineConfig,
  getPipelineConfig,
  resetConfig,
  getConfig,
} from "../src/core/config.js";

describe("getDefaultPipelineConfig", () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it("should return the config object directly, not wrapped in {config, error}", () => {
    const result = getDefaultPipelineConfig();

    // Should return the config object directly
    expect(result).not.toHaveProperty("config");
    expect(result).not.toHaveProperty("error");

    // Should have the expected pipeline config properties
    expect(result).toHaveProperty("slug", "content");
    expect(result).toHaveProperty("name", "Demo Content Pipeline");
    expect(result).toHaveProperty("pipelinePath");
    expect(result).toHaveProperty("taskRegistryPath");
  });

  it("should return the same config as getPipelineConfig().config", () => {
    const defaultConfig = getDefaultPipelineConfig();
    const fullResult = getPipelineConfig("content");

    expect(defaultConfig).toEqual(fullResult.config);
  });

  it("should return null when no default slug is configured", () => {
    // Modify config to have no default slug
    const config = getConfig();
    config.pipelines.defaultSlug = null;

    const result = getDefaultPipelineConfig();
    expect(result).toBeNull();
  });

  it("should throw error when default slug doesn't exist in slugs", () => {
    // Modify config to have invalid default slug
    const config = getConfig();
    config.pipelines.defaultSlug = "nonexistent";

    expect(() => getDefaultPipelineConfig()).toThrow(
      'Default pipeline slug "nonexistent" does not exist in pipelines.slugs.'
    );
  });

  it("should return absolute paths", () => {
    const result = getDefaultPipelineConfig();

    expect(result.pipelinePath).toMatch(/^\/.*pipeline\.json$/);
    expect(result.taskRegistryPath).toMatch(/^\/.*index\.js$/);
  });
});
