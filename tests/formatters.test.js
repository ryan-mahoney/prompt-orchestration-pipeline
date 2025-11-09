import { describe, it, expect } from "vitest";
import {
  formatCurrency4,
  formatTokensCompact,
} from "../src/utils/formatters.js";

describe("formatters", () => {
  describe("formatCurrency4", () => {
    it("formats zero correctly", () => {
      expect(formatCurrency4(0)).toBe("$0.0000");
    });

    it("formats small decimal correctly", () => {
      expect(formatCurrency4(0.1234)).toBe("$0.1234");
    });

    it("trims trailing zeros", () => {
      expect(formatCurrency4(0.1)).toBe("$0.1");
      expect(formatCurrency4(0.123)).toBe("$0.123");
    });

    it("handles whole numbers", () => {
      expect(formatCurrency4(1)).toBe("$1");
    });

    it("handles non-numeric input", () => {
      expect(formatCurrency4(null)).toBe("$0.0000");
      expect(formatCurrency4(undefined)).toBe("$0.0000");
      expect(formatCurrency4("invalid")).toBe("$0.0000");
    });
  });

  describe("formatTokensCompact", () => {
    it("formats zero correctly", () => {
      expect(formatTokensCompact(0)).toBe("0 tok");
    });

    it("formats small numbers without suffix", () => {
      expect(formatTokensCompact(500)).toBe("500 tokens");
      expect(formatTokensCompact(999)).toBe("999 tokens");
    });

    it("formats thousands with k suffix", () => {
      expect(formatTokensCompact(1000)).toBe("1k tokens");
      expect(formatTokensCompact(1500)).toBe("1.5k tokens");
      expect(formatTokensCompact(1234)).toBe("1.2k tokens");
    });

    it("trims trailing .0 from k suffix", () => {
      expect(formatTokensCompact(2000)).toBe("2k tokens");
      expect(formatTokensCompact(3000)).toBe("3k tokens");
    });

    it("formats millions with M suffix", () => {
      expect(formatTokensCompact(1000000)).toBe("1M tokens");
      expect(formatTokensCompact(1500000)).toBe("1.5M tokens");
      expect(formatTokensCompact(1234567)).toBe("1.2M tokens");
    });

    it("trims trailing .0 from M suffix", () => {
      expect(formatTokensCompact(2000000)).toBe("2M tokens");
      expect(formatTokensCompact(3000000)).toBe("3M tokens");
    });

    it("handles non-numeric input", () => {
      expect(formatTokensCompact(null)).toBe("0 tok");
      expect(formatTokensCompact(undefined)).toBe("0 tok");
      expect(formatTokensCompact("invalid")).toBe("0 tok");
    });
  });
});
