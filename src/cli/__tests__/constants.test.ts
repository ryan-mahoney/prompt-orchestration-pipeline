import { describe, expect, it } from "vitest";
import { KEBAB_CASE_REGEX, STAGE_NAMES, getStagePurpose } from "../constants";

describe("STAGE_NAMES", () => {
  it("has exactly 11 entries", () => {
    expect(STAGE_NAMES).toHaveLength(11);
  });

  it("starts with ingestion and ends with integration", () => {
    expect(STAGE_NAMES[0]).toBe("ingestion");
    expect(STAGE_NAMES[10]).toBe("integration");
  });
});

describe("getStagePurpose", () => {
  it("returns a non-empty string for a known stage", () => {
    expect(getStagePurpose("ingestion").length).toBeGreaterThan(0);
  });

  it("returns an empty string for an unknown stage", () => {
    expect(getStagePurpose("unknown")).toBe("");
  });
});

describe("KEBAB_CASE_REGEX", () => {
  it("matches valid kebab-case slugs", () => {
    expect(KEBAB_CASE_REGEX.test("valid-slug")).toBe(true);
  });

  it("rejects slugs with uppercase or underscores", () => {
    expect(KEBAB_CASE_REGEX.test("Invalid_Slug")).toBe(false);
  });
});
