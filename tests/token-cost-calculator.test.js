/**
 * Tests for token cost calculator utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateSingleTokenCost,
  calculateMultipleTokenCosts,
  calculateJobCosts,
  formatCostDataForAPI,
  getModelPricing,
  getAllModelPricing,
} from "../src/utils/token-cost-calculator.js";

describe("Token Cost Calculator", () => {
  beforeEach(() => {
    // Set PO_ROOT to avoid config errors
    process.env.PO_ROOT = "/mock/root";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PO_ROOT;
  });

  describe("calculateSingleTokenCost", () => {
    it("should calculate cost correctly for valid entry", () => {
      const entry = ["openai:gpt-5-mini", 1000, 500];
      const result = calculateSingleTokenCost(entry);

      expect(result).toEqual({
        modelKey: "openai:gpt-5-mini",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputCost: 0.00025, // 1000 * 0.25 / 1M
        outputCost: 0.001, // 500 * 2.0 / 1M
        totalCost: 0.00125, // 0.00025 + 0.001
        provider: "openai",
        model: "gpt-5-mini",
      });
    });

    it("should handle invalid entry gracefully", () => {
      const result = calculateSingleTokenCost([1, 2]); // Missing modelKey

      expect(result).toEqual({
        modelKey: null,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
      });
    });

    it("should handle unknown model", () => {
      const entry = ["unknown:model", 1000, 500];
      const result = calculateSingleTokenCost(entry);

      expect(result).toEqual({
        modelKey: "unknown:model",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
      });
    });

    it("should handle zero tokens", () => {
      const entry = ["openai:gpt-5-mini", 0, 0];
      const result = calculateSingleTokenCost(entry);

      expect(result.totalCost).toBe(0);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });
  });

  describe("calculateMultipleTokenCosts", () => {
    it("should aggregate costs for multiple entries", () => {
      const entries = [
        ["openai:gpt-5-mini", 1000, 500],
        ["deepseek:chat", 500, 250],
        ["openai:gpt-5-mini", 200, 100],
      ];

      const result = calculateMultipleTokenCosts(entries);

      expect(result.summary).toEqual({
        totalInputTokens: 1700, // 1000 + 500 + 200
        totalOutputTokens: 850, // 500 + 250 + 100
        totalTokens: 2550, // 1700 + 850
        totalInputCost: 0.000595, // 0.00025 + 0.000135 + 0.00005
        totalOutputCost: 0.00275, // 0.001 + 0.000275 + 0.0002
        totalCost: 0.003345, // 0.000595 + 0.00275
        modelBreakdown: {
          "openai:gpt-5-mini": {
            provider: "openai",
            model: "gpt-5-mini",
            inputTokens: 1200, // 1000 + 200
            outputTokens: 600, // 500 + 100
            totalTokens: 1800,
            inputCost: 0.0003, // 0.00025 + 0.00005
            outputCost: 0.0012, // 0.001 + 0.0002
            totalCost: 0.0015,
            requestCount: 2,
          },
          "deepseek:chat": {
            provider: "deepseek",
            model: "deepseek-chat",
            inputTokens: 500,
            outputTokens: 250,
            totalTokens: 750,
            inputCost: 0.000135, // 500 * 0.27 / 1M
            outputCost: 0.000275, // 250 * 1.1 / 1M
            totalCost: 0.00041,
            requestCount: 1,
          },
        },
      });
    });

    it("should handle empty array", () => {
      const result = calculateMultipleTokenCosts([]);

      expect(result.entries).toEqual([]);
      expect(result.summary.totalTokens).toBe(0);
    });
  });

  describe("calculateJobCosts", () => {
    it("should calculate costs for entire job", () => {
      const tasksStatus = {
        tasks: {
          research: {
            tokenUsage: [
              ["openai:gpt-5-mini", 1000, 500],
              ["deepseek:chat", 500, 250],
            ],
          },
          analysis: {
            tokenUsage: [["openai:gpt-5-mini", 200, 100]],
          },
        },
      };

      const result = calculateJobCosts(tasksStatus);

      expect(result.jobLevel.summary.totalInputTokens).toBe(1700);
      expect(result.jobLevel.summary.totalOutputTokens).toBe(850);
      expect(result.jobLevel.summary.totalCost).toBe(0.003345);

      expect(Object.keys(result.tasksLevel)).toEqual(["research", "analysis"]);
      expect(result.tasksLevel.research.summary.totalInputTokens).toBe(1500);
      expect(result.tasksLevel.analysis.summary.totalInputTokens).toBe(200);
    });

    it("should aggregate job-level costs from raw tuples correctly", () => {
      const tasksStatus = {
        tasks: {
          research: {
            tokenUsage: [["openai:gpt-5-mini", 287, 2928]],
          },
          analysis: {
            tokenUsage: [["deepseek:chat", 2144, 566]],
          },
        },
      };

      const result = calculateJobCosts(tasksStatus);

      // Verify job-level totals match sum of task-level totals
      expect(result.jobLevel.summary.totalInputTokens).toBe(287 + 2144);
      expect(result.jobLevel.summary.totalOutputTokens).toBe(2928 + 566);
      expect(result.jobLevel.summary.totalTokens).toBe(3215 + 2710);

      // Verify modelBreakdown uses real modelKeys, not 'null'
      expect(Object.keys(result.jobLevel.summary.modelBreakdown)).toEqual(
        expect.arrayContaining(["openai:gpt-5-mini", "deepseek:chat"])
      );
      expect(result.jobLevel.summary.modelBreakdown["null"]).toBeUndefined();
    });

    it("should calculate costs for specific task", () => {
      const tasksStatus = {
        tasks: {
          research: {
            tokenUsage: [
              ["openai:gpt-5-mini", 1000, 500],
              ["deepseek:chat", 500, 250],
            ],
          },
          analysis: {
            tokenUsage: [["openai:gpt-5-mini", 200, 100]],
          },
        },
      };

      const result = calculateJobCosts(tasksStatus, "research");

      expect(result.jobLevel.summary.totalInputTokens).toBe(1500);
      expect(result.jobLevel.summary.totalOutputTokens).toBe(750);
      expect(result.tasksLevel.research.summary.totalInputTokens).toBe(1500);
      expect(result.tasksLevel.analysis).toBeUndefined();
    });

    it("should handle missing tasks", () => {
      const tasksStatus = { tasks: {} };
      const result = calculateJobCosts(tasksStatus);

      expect(result.jobLevel.summary.totalTokens).toBe(0);
      expect(Object.keys(result.tasksLevel)).toEqual([]);
    });
  });

  describe("formatCostDataForAPI", () => {
    it("should format cost data for API response", () => {
      const costData = {
        jobLevel: {
          summary: {
            totalInputTokens: 1700,
            totalOutputTokens: 850,
            totalTokens: 2550,
            totalInputCost: 0.000595,
            totalOutputCost: 0.00275,
            totalCost: 0.003345,
            modelBreakdown: {
              "openai:gpt-5-mini": {
                provider: "openai",
                model: "gpt-5-mini",
                inputTokens: 1200,
                outputTokens: 600,
                totalTokens: 1800,
                inputCost: 0.0003,
                outputCost: 0.0012,
                totalCost: 0.0015,
                requestCount: 2,
              },
            },
          },
          entries: [],
        },
        tasksLevel: {
          research: {
            summary: {
              totalInputTokens: 1500,
              totalOutputTokens: 750,
              totalTokens: 2250,
              totalInputCost: 0.000385,
              totalOutputCost: 0.001275,
              totalCost: 0.00166,
              modelBreakdown: {},
            },
            entries: [],
          },
        },
      };

      const formatted = formatCostDataForAPI(costData);

      expect(formatted).toEqual({
        summary: {
          totalInputTokens: 1700,
          totalOutputTokens: 850,
          totalTokens: 2550,
          totalInputCost: 0.000595,
          totalOutputCost: 0.00275,
          totalCost: 0.003345,
        },
        modelBreakdown: {
          "openai:gpt-5-mini": {
            provider: "openai",
            model: "gpt-5-mini",
            inputTokens: 1200,
            outputTokens: 600,
            totalTokens: 1800,
            inputCost: 0.0003,
            outputCost: 0.0012,
            totalCost: 0.0015,
            requestCount: 2,
          },
        },
        taskBreakdown: {
          research: {
            summary: {
              totalInputTokens: 1500,
              totalOutputTokens: 750,
              totalTokens: 2250,
              totalInputCost: 0.000385,
              totalOutputCost: 0.001275,
              totalCost: 0.00166,
              modelBreakdown: {},
            },
            entries: [],
          },
        },
      });
    });
  });

  describe("getModelPricing", () => {
    it("should return pricing for known model", () => {
      const pricing = getModelPricing("openai:gpt-5-mini");

      expect(pricing).toEqual({
        modelKey: "openai:gpt-5-mini",
        provider: "openai",
        model: "gpt-5-mini",
        inputCostPerMillion: 0.25,
        outputCostPerMillion: 2.0,
      });
    });

    it("should return null for unknown model", () => {
      const pricing = getModelPricing("unknown:model");

      expect(pricing).toBeNull();
    });
  });

  describe("getAllModelPricing", () => {
    it("should return all model pricing", () => {
      const pricing = getAllModelPricing();

      expect(Object.keys(pricing)).toEqual([
        "openai:gpt-5-mini",
        "deepseek:chat",
      ]);

      expect(pricing["openai:gpt-5-mini"]).toEqual({
        modelKey: "openai:gpt-5-mini",
        provider: "openai",
        model: "gpt-5-mini",
        inputCostPerMillion: 0.25,
        outputCostPerMillion: 2.0,
      });
    });
  });
});
