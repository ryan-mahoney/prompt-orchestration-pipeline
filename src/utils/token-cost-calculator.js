/**
 * Token usage and cost calculation utilities
 *
 * This module provides functions to calculate costs from token usage data
 * by cross-referencing with LLM model pricing configuration.
 */

import { MODEL_CONFIG } from "../config/models.js";

/**
 * Calculate cost for a single token usage entry
 * @param {Array} tokenUsageEntry - [modelKey, inputTokens, outputTokens]
 * @param {Object} modelsConfig - LLM models configuration
 * @returns {Object} Cost calculation result
 */
export function calculateSingleTokenCost(tokenUsageEntry, modelsConfig = null) {
  if (!Array.isArray(tokenUsageEntry) || tokenUsageEntry.length < 3) {
    return {
      modelKey: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
    };
  }

  const [modelKey, inputTokens, outputTokens] = tokenUsageEntry;

  // Get models config if not provided
  const config = modelsConfig || MODEL_CONFIG;
  const modelConfig = config[modelKey];

  if (!modelConfig) {
    console.warn(
      `[token-cost-calculator] Model configuration not found for: ${modelKey}`
    );
    return {
      modelKey,
      inputTokens: Number(inputTokens) || 0,
      outputTokens: Number(outputTokens) || 0,
      totalTokens: (Number(inputTokens) || 0) + (Number(outputTokens) || 0),
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
    };
  }

  const inputCost =
    ((Number(inputTokens) || 0) * (modelConfig.tokenCostInPerMillion || 0)) /
    1_000_000;
  const outputCost =
    ((Number(outputTokens) || 0) * (modelConfig.tokenCostOutPerMillion || 0)) /
    1_000_000;
  const totalCost = inputCost + outputCost;

  return {
    modelKey,
    inputTokens: Number(inputTokens) || 0,
    outputTokens: Number(outputTokens) || 0,
    totalTokens: (Number(inputTokens) || 0) + (Number(outputTokens) || 0),
    inputCost: Math.round(inputCost * 10000) / 10000, // Round to 4 decimal places
    outputCost: Math.round(outputCost * 10000) / 10000,
    totalCost: Math.round(totalCost * 10000) / 10000,
    provider: modelConfig.provider,
    model: modelConfig.model,
  };
}

/**
 * Calculate costs for multiple token usage entries
 * @param {Array} tokenUsageArray - Array of [modelKey, inputTokens, outputTokens] entries
 * @param {Object} modelsConfig - LLM models configuration
 * @returns {Object} Aggregated cost calculation
 */
export function calculateMultipleTokenCosts(
  tokenUsageArray,
  modelsConfig = null
) {
  if (!Array.isArray(tokenUsageArray) || tokenUsageArray.length === 0) {
    return {
      entries: [],
      summary: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalInputCost: 0,
        totalOutputCost: 0,
        totalCost: 0,
        modelBreakdown: {},
      },
    };
  }

  const entries = tokenUsageArray.map((entry) =>
    calculateSingleTokenCost(entry, modelsConfig)
  );

  // Aggregate totals
  const summary = entries.reduce(
    (acc, entry) => {
      acc.totalInputTokens += entry.inputTokens;
      acc.totalOutputTokens += entry.outputTokens;
      acc.totalTokens += entry.totalTokens;
      acc.totalInputCost += entry.inputCost;
      acc.totalOutputCost += entry.outputCost;
      acc.totalCost += entry.totalCost;

      // Model breakdown
      const modelKey = entry.modelKey;
      if (!acc.modelBreakdown[modelKey]) {
        acc.modelBreakdown[modelKey] = {
          provider: entry.provider,
          model: entry.model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          requestCount: 0,
        };
      }

      const breakdown = acc.modelBreakdown[modelKey];
      breakdown.inputTokens += entry.inputTokens;
      breakdown.outputTokens += entry.outputTokens;
      breakdown.totalTokens += entry.totalTokens;
      breakdown.inputCost += entry.inputCost;
      breakdown.outputCost += entry.outputCost;
      breakdown.totalCost += entry.totalCost;
      breakdown.requestCount += 1;

      return acc;
    },
    {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalInputCost: 0,
      totalOutputCost: 0,
      totalCost: 0,
      modelBreakdown: {},
    }
  );

  // Round all cost values in summary
  summary.totalInputCost = Math.round(summary.totalInputCost * 10000) / 10000;
  summary.totalOutputCost = Math.round(summary.totalOutputCost * 10000) / 10000;
  summary.totalCost = Math.round(summary.totalCost * 10000) / 10000;

  // Round model breakdown costs
  Object.values(summary.modelBreakdown).forEach((breakdown) => {
    breakdown.inputCost = Math.round(breakdown.inputCost * 10000) / 10000;
    breakdown.outputCost = Math.round(breakdown.outputCost * 10000) / 10000;
    breakdown.totalCost = Math.round(breakdown.totalCost * 10000) / 10000;
  });

  return { entries, summary };
}

/**
 * Extract and calculate token usage costs from tasks-status.json data
 * @param {Object} tasksStatus - The tasks-status.json content
 * @param {string} taskName - Optional specific task name to calculate for
 * @returns {Object} Cost calculation for entire job or specific task
 */
export function calculateJobCosts(tasksStatus, taskName = null) {
  if (!tasksStatus || typeof tasksStatus !== "object") {
    return {
      jobLevel: {
        entries: [],
        summary: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalInputCost: 0,
          totalOutputCost: 0,
          totalCost: 0,
          modelBreakdown: {},
        },
      },
      tasksLevel: {},
    };
  }

  const tasks = tasksStatus.tasks || {};

  // If specific task requested, calculate only for that task
  if (taskName && tasks[taskName]) {
    const taskTokenUsage = tasks[taskName].tokenUsage || [];
    const taskCosts = calculateMultipleTokenCosts(taskTokenUsage);

    return {
      jobLevel: taskCosts,
      tasksLevel: {
        [taskName]: taskCosts,
      },
    };
  }

  // Calculate for all tasks
  const tasksLevel = {};
  const allEntries = [];
  const allTuples = [];

  for (const [currentTaskName, taskData] of Object.entries(tasks)) {
    const taskTokenUsage = taskData.tokenUsage || [];
    const taskCosts = calculateMultipleTokenCosts(taskTokenUsage);
    tasksLevel[currentTaskName] = taskCosts;
    allEntries.push(...taskCosts.entries);
    allTuples.push(...taskTokenUsage);
  }

  // Calculate job-level aggregation from raw tuples
  const jobLevel = calculateMultipleTokenCosts(allTuples);

  return {
    jobLevel,
    tasksLevel,
  };
}

/**
 * Format cost data for API response
 * @param {Object} costData - Cost calculation data
 * @returns {Object} Formatted cost data for API
 */
export function formatCostDataForAPI(costData) {
  const { jobLevel, tasksLevel } = costData;

  return {
    summary: {
      totalInputTokens: jobLevel.summary.totalInputTokens,
      totalOutputTokens: jobLevel.summary.totalOutputTokens,
      totalTokens: jobLevel.summary.totalTokens,
      totalInputCost: jobLevel.summary.totalInputCost,
      totalOutputCost: jobLevel.summary.totalOutputCost,
      totalCost: jobLevel.summary.totalCost,
    },
    modelBreakdown: jobLevel.summary.modelBreakdown,
    taskBreakdown: Object.entries(tasksLevel).reduce(
      (acc, [taskName, taskData]) => {
        acc[taskName] = {
          summary: taskData.summary,
          entries: taskData.entries,
        };
        return acc;
      },
      {}
    ),
  };
}

/**
 * Get model pricing information
 * @param {string} modelKey - Model key (e.g., "openai:gpt-5-mini")
 * @returns {Object|null} Model pricing information
 */
export function getModelPricing(modelKey) {
  const modelConfig = MODEL_CONFIG[modelKey];

  if (!modelConfig) {
    return null;
  }

  return {
    modelKey,
    provider: modelConfig.provider,
    model: modelConfig.model,
    inputCostPerMillion: modelConfig.tokenCostInPerMillion,
    outputCostPerMillion: modelConfig.tokenCostOutPerMillion,
  };
}

/**
 * Get all available model pricing information
 * @returns {Object} All model pricing information
 */
export function getAllModelPricing() {
  const pricing = {};
  for (const [modelKey, modelConfig] of Object.entries(MODEL_CONFIG)) {
    pricing[modelKey] = {
      modelKey,
      provider: modelConfig.provider,
      model: modelConfig.model,
      inputCostPerMillion: modelConfig.tokenCostInPerMillion,
      outputCostPerMillion: modelConfig.tokenCostOutPerMillion,
    };
  }

  return pricing;
}
