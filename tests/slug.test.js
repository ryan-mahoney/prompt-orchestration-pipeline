import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateSlug, ensureUniqueSlug } from "../src/ui/utils/slug.js";

describe("generateSlug", () => {
  it("converts to lowercase", () => {
    expect(generateSlug("My Pipeline")).toBe("my-pipeline");
  });

  it("replaces spaces and special characters with hyphens", () => {
    expect(generateSlug("My@Awesome#Pipeline!")).toBe("my-awesome-pipeline");
  });

  it("removes leading and trailing hyphens", () => {
    expect(generateSlug("--test--")).toBe("test");
    expect(generateSlug("  test  ")).toBe("test");
  });

  it("truncates to 47 characters", () => {
    const longName = "a".repeat(100);
    const slug = generateSlug(longName);
    expect(slug.length).toBe(47);
    expect(slug).toBe("a".repeat(47));
  });

  it("handles empty string", () => {
    expect(generateSlug("")).toBe("");
  });

  it("handles consecutive non-alphanumeric characters", () => {
    expect(generateSlug("test!!!pipeline")).toBe("test-pipeline");
  });

  it("preserves numbers", () => {
    expect(generateSlug("Pipeline 2.0")).toBe("pipeline-2-0");
  });

  it("handles multiple spaces", () => {
    expect(generateSlug("My   Pipeline   Name")).toBe("my-pipeline-name");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns original slug if not in existing set", () => {
    const existingSlugs = new Set(["other-slug", "another-slug"]);
    expect(ensureUniqueSlug("my-slug", existingSlugs)).toBe("my-slug");
  });

  it("appends -1 if slug exists", () => {
    const existingSlugs = new Set(["my-slug", "other-slug"]);
    expect(ensureUniqueSlug("my-slug", existingSlugs)).toBe("my-slug-1");
  });

  it("increments suffix until finding unique slug", () => {
    const existingSlugs = new Set([
      "my-slug",
      "my-slug-1",
      "my-slug-2",
      "other-slug",
    ]);
    expect(ensureUniqueSlug("my-slug", existingSlugs)).toBe("my-slug-3");
  });

  it("handles consecutive numbering starting from 1", () => {
    const existingSlugs = new Set(["test"]);
    expect(ensureUniqueSlug("test", existingSlugs)).toBe("test-1");
  });

  it("handles gaps in numbering", () => {
    const existingSlugs = new Set(["test", "test-1", "test-3"]);
    expect(ensureUniqueSlug("test", existingSlugs)).toBe("test-2");
  });

  it("works with empty existing set", () => {
    const existingSlugs = new Set();
    expect(ensureUniqueSlug("my-slug", existingSlugs)).toBe("my-slug");
  });
});

describe("slug integration", () => {
  it("generates and ensures uniqueness for pipeline names", () => {
    const name = "My Pipeline";
    const baseSlug = generateSlug(name);
    expect(baseSlug).toBe("my-pipeline");

    const existingSlugs = new Set(["my-pipeline"]);
    const uniqueSlug = ensureUniqueSlug(baseSlug, existingSlugs);
    expect(uniqueSlug).toBe("my-pipeline-1");
  });

  it("handles special characters in names", () => {
    const name = "Content Generation!!!";
    const baseSlug = generateSlug(name);
    expect(baseSlug).toBe("content-generation");

    const existingSlugs = new Set(["content-generation"]);
    const uniqueSlug = ensureUniqueSlug(baseSlug, existingSlugs);
    expect(uniqueSlug).toBe("content-generation-1");
  });
});
