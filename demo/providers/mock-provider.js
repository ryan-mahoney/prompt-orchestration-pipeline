// Mock LLM provider for demo purposes
// Follows the same interface as real providers (openai.js, deepseek.js)

import { extractMessages, tryParseJSON } from "../../src/providers/base.js";

/**
 * Mock provider that simulates LLM responses for demo purposes
 * Implements the same interface as real providers
 */
export class MockProvider {
  constructor(config = {}) {
    this.config = {
      simulateLatency: config.simulateLatency ?? true,
      minLatency: config.minLatency ?? 100,
      maxLatency: config.maxLatency ?? 300,
      failureRate: config.failureRate ?? 0,
      ...config,
    };
  }

  /**
   * Main chat interface - matches openaiChat signature
   */
  async chat(options) {
    const {
      messages = [],
      model = "gpt-3.5-turbo",
      temperature = 0.7,
      maxTokens,
      responseFormat,
      ...rest
    } = options;

    // Simulate network latency
    if (this.config.simulateLatency) {
      const latency =
        this.config.minLatency +
        Math.random() * (this.config.maxLatency - this.config.minLatency);
      await new Promise((resolve) => setTimeout(resolve, latency));
    }

    // Simulate random failures for testing error handling
    if (Math.random() < this.config.failureRate) {
      throw new Error("Mock provider simulated failure");
    }

    const { systemMsg, userMsg } = extractMessages(messages);

    // Generate mock response based on content
    const content = this.generateMockResponse(systemMsg, userMsg, {
      model,
      temperature,
      responseFormat,
    });

    // Calculate token usage
    const promptTokens = this.estimateTokens((systemMsg ?? "") + (userMsg ?? ""));
    const completionTokens = this.estimateTokens(content);
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };

    // Parse JSON if requested
    let parsed = null;
    if (
      responseFormat?.json_schema ||
      responseFormat?.type === "json_object" ||
      responseFormat === "json"
    ) {
      parsed = tryParseJSON(content);
    }

    return {
      content: parsed ?? content,
      text: content,
      usage,
      model,
      raw: {
        id: `mock_${Date.now()}`,
        model,
        usage,
        choices: [
          {
            message: {
              role: "assistant",
              content,
            },
            finish_reason: "stop",
          },
        ],
      },
    };
  }

  /**
   * Generate intelligent mock responses based on message content
   */
  generateMockResponse(systemMsg, userMsg, options = {}) {
    const combined = (systemMsg + " " + userMsg).toLowerCase();

    // Data extraction responses
    if (combined.includes("extract") || combined.includes("data extraction")) {
      return this.generateDataExtractionResponse(userMsg);
    }

    // Analysis responses
    if (combined.includes("analyz") || combined.includes("insight")) {
      return this.generateAnalysisResponse(userMsg);
    }

    // Report generation responses
    if (combined.includes("report") || combined.includes("generate")) {
      return this.generateReportResponse(userMsg);
    }

    // Critique responses
    if (combined.includes("critique") || combined.includes("quality")) {
      return this.generateCritiqueResponse(userMsg);
    }

    // Generic response
    return this.generateGenericResponse(userMsg, options);
  }

  generateDataExtractionResponse(userMsg) {
    // Extract industry/region from prompt if present
    const industryMatch = userMsg.match(/(\w+)\s+industry/i);
    const regionMatch = userMsg.match(/in\s+(\w+(?:\s+\w+)?)/i);

    const industry = industryMatch ? industryMatch[1] : "Technology";
    const region = regionMatch ? regionMatch[1] : "North America";

    return `# Market Data Extraction

## Key Companies
- Company A: Leading provider with 35% market share
- Company B: Fast-growing startup with innovative solutions
- Company C: Established player focusing on enterprise segment

## Market Size
- Current market size: $12.5 billion
- Projected growth: 15% CAGR over next 5 years
- ${region} represents 40% of global market

## Key Trends
1. Digital transformation driving adoption
2. Increasing focus on sustainability
3. Consolidation through M&A activity
4. Shift towards subscription-based models

## Industry Insights
The ${industry} industry in ${region} shows strong growth potential with increasing investment in innovation and technology adoption.`;
  }

  generateAnalysisResponse(userMsg) {
    return `# Market Analysis

## Executive Summary
Based on the extracted data, the market demonstrates strong fundamentals with consistent growth trajectory and healthy competitive dynamics.

## Key Findings
1. **Market Growth**: 15% CAGR indicates robust demand
2. **Competition**: Fragmented market with opportunities for consolidation
3. **Innovation**: High R&D investment driving product differentiation
4. **Customer Adoption**: Increasing enterprise adoption rates

## Strategic Implications
- Market leaders should focus on innovation and customer retention
- New entrants have opportunities in underserved segments
- Technology partnerships will be critical for success

## Risk Factors
- Regulatory changes could impact growth
- Economic downturn may affect enterprise spending
- Competitive pressure on pricing

## Recommendations
1. Invest in product development
2. Expand geographic presence
3. Build strategic partnerships
4. Focus on customer success`;
  }

  generateReportResponse(userMsg) {
    return `# Market Analysis Report

## Introduction
This report provides a comprehensive analysis of market dynamics, competitive landscape, and growth opportunities.

## Market Overview
The market demonstrates strong fundamentals with consistent growth and healthy competitive dynamics. Key players are investing heavily in innovation and customer acquisition.

## Competitive Analysis
### Market Leaders
- Company A: Dominant position with strong brand recognition
- Company B: Innovative challenger with rapid growth
- Company C: Established player with enterprise focus

### Market Dynamics
- Increasing consolidation through M&A
- Technology disruption creating new opportunities
- Customer preferences shifting towards integrated solutions

## Growth Opportunities
1. Geographic expansion into emerging markets
2. Product innovation and differentiation
3. Strategic partnerships and alliances
4. Digital transformation initiatives

## Conclusion
The market presents attractive opportunities for well-positioned players with strong execution capabilities and customer focus.

---
*Report generated: ${new Date().toISOString()}*`;
  }

  generateCritiqueResponse(userMsg) {
    if (userMsg.includes("too short") || userMsg.includes("missing")) {
      return `The output appears incomplete. To improve:

1. Provide more detailed analysis with specific data points
2. Include quantitative metrics and statistics
3. Add more context about market dynamics
4. Expand on key trends and implications

Suggested improvements:
- Add specific company names and market share data
- Include financial metrics and growth rates
- Provide more detailed competitive analysis
- Add supporting evidence for claims`;
    }

    if (userMsg.includes("confidence") || userMsg.includes("quality")) {
      return `The output quality could be improved:

1. Add more specific examples and case studies
2. Include data sources and references
3. Provide more detailed analysis of trends
4. Strengthen conclusions with supporting evidence

Recommendations:
- Use more precise language and terminology
- Add quantitative analysis where possible
- Include industry-specific insights
- Provide actionable recommendations`;
    }

    return `The output meets basic requirements but could be enhanced with more depth and specificity. Consider adding more detailed analysis and supporting evidence.`;
  }

  generateGenericResponse(userMsg, options = {}) {
    const { responseFormat } = options;

    // If JSON format requested, return structured data
    if (
      responseFormat?.json_schema ||
      responseFormat?.type === "json_object" ||
      responseFormat === "json"
    ) {
      return JSON.stringify({
        response: "Mock response generated successfully",
        timestamp: new Date().toISOString(),
        confidence: 0.85,
        metadata: {
          model: options.model || "gpt-3.5-turbo",
          temperature: options.temperature || 0.7,
        },
      });
    }

    // Default text response
    return `This is a mock response generated for demonstration purposes. 

The system received your request and processed it successfully. In a production environment, this would be replaced with actual LLM-generated content based on the prompt and context provided.

Key points:
- Mock provider is functioning correctly
- Response format matches expected structure
- Token usage is being tracked
- Metrics are being collected

This demonstrates the architecture without requiring actual API keys or incurring costs.`;
  }

  /**
   * Estimate token count (simple approximation)
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate mock cost based on model
   */
  calculateCost(model, usage) {
    const rates = {
      "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
      "gpt-4": { input: 0.03, output: 0.06 },
      "gpt-4-turbo": { input: 0.01, output: 0.03 },
    };

    const rate = rates[model] || rates["gpt-3.5-turbo"];
    const promptCost = ((usage.prompt_tokens || 0) / 1000) * rate.input;
    const completionCost =
      ((usage.completion_tokens || 0) / 1000) * rate.output;

    return promptCost + completionCost;
  }
}

/**
 * Factory function to create mock provider instance
 */
export function createMockProvider(config = {}) {
  return new MockProvider(config);
}

/**
 * Mock chat function that matches the provider interface
 * This is the main entry point used by the LLM layer
 */
export async function mockChat(systemMsg, userMsg, options = {}) {
  const provider = new MockProvider();

  const messages = [];
  if (systemMsg) {
    messages.push({ role: "system", content: systemMsg });
  }
  if (userMsg) {
    messages.push({ role: "user", content: userMsg });
  }

  const result = await provider.chat({
    messages,
    ...options,
  });

  // Return in the format expected by LLM layer
  return result.content;
}
