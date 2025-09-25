export const MockChatGPT = {
  selectBestModel(taskType, complexity) {
    const modelMap = {
      "analysis-high": "gpt-4-turbo",
      "analysis-medium": "gpt-4",
      "analysis-low": "gpt-3.5-turbo",
      "extraction-high": "gpt-4",
      "extraction-medium": "gpt-3.5-turbo",
      "extraction-low": "gpt-3.5-turbo",
      default: "gpt-3.5-turbo",
    };

    const key = `${taskType}-${complexity}`;
    return modelMap[key] || modelMap.default;
  },
};

// Store different mock responses for different task types
const mockResponses = {
  report: {
    content: `# Executive Report: Market Analysis and Strategic Recommendations

## Executive Summary

This report presents a comprehensive analysis of the current market landscape, identifying critical growth opportunities and strategic imperatives for competitive positioning. Our research indicates a market poised for significant expansion, with a projected value of $245.6B by 2028 and annual growth rates exceeding 18%. Key findings highlight the urgent need for digital transformation, strategic partnerships, and innovation-led differentiation to capture emerging opportunities.

The analysis reveals three primary strategic imperatives: (1) accelerate digital capabilities to meet evolving customer expectations, (2) expand into high-growth geographic markets, particularly Asia-Pacific, and (3) develop ecosystem partnerships to enhance value proposition. Implementation of recommended strategies is projected to deliver 35% revenue growth and 500 basis points margin improvement within 24 months.

## Key Findings

Our comprehensive market analysis has uncovered several critical insights that will shape strategic decision-making:

**Market Dynamics**
- The total addressable market has expanded by 45% over the past three years, driven primarily by digital transformation initiatives and changing consumer behaviors
- Industry consolidation is accelerating, with M&A activity up 67% year-over-year, creating both opportunities and competitive threats
- Technology adoption rates have reached an inflection point, with 78% of enterprises now considering digital capabilities as mission-critical
- Customer acquisition costs have increased by 125% industry-wide, necessitating focus on retention and lifetime value optimization

**Competitive Positioning**
- Market leadership remains concentrated among three major players controlling 65% combined market share
- New entrants backed by $800M in venture funding are disrupting traditional business models
- Competitive advantage increasingly derives from data capabilities and ecosystem partnerships rather than traditional product features
- Price competition has intensified, with average selling prices declining 12% annually

**Growth Vectors**
- Geographic expansion presents the highest ROI opportunity, with untapped markets offering $18.5B in potential revenue
- Service layer monetization can improve gross margins from 40% to 65% while creating recurring revenue streams
- Strategic acquisitions of capability-focused startups offer accelerated innovation at favorable valuations

## Market Insights

**Industry Transformation Drivers**

The market is experiencing fundamental transformation driven by converging technological, regulatory, and social factors. Digital-first business models have moved from competitive advantage to table stakes, with laggards facing existential threats. Cloud infrastructure adoption has reached 89% penetration, enabling rapid scaling and innovation cycles that have compressed from 18 to 8 months.

Regulatory frameworks are evolving rapidly, with new compliance requirements in data privacy, sustainability reporting, and algorithmic transparency creating both challenges and opportunities. Companies demonstrating leadership in ESG metrics are commanding valuation premiums of 15-20%, while those failing to adapt face increasing cost of capital and restricted market access.

**Customer Evolution Patterns**

Customer expectations have fundamentally shifted, with personalization, real-time service, and omnichannel experiences now baseline requirements. B2B buyers increasingly expect B2C-like experiences, driving consumerization of enterprise technology. Decision-making processes have become more complex, with average buying committees expanding from 5 to 11 stakeholders, requiring sophisticated multi-persona engagement strategies.

Data sovereignty concerns and security requirements have become primary selection criteria, with 67% of enterprise buyers citing security as their top priority. This shift creates opportunities for vendors demonstrating robust security capabilities and compliance certifications to capture premium pricing.

**Emerging Technology Impact**

Artificial intelligence and machine learning have moved from experimental to operational, with 67% of enterprises deploying AI in production environments. Natural language processing capabilities are revolutionizing customer service, with AI-powered systems handling 45% of initial customer interactions. Computer vision and predictive analytics are creating new revenue streams and operational efficiencies previously impossible.

Blockchain and distributed ledger technologies are gaining traction in supply chain transparency and transaction verification, though widespread adoption remains 2-3 years away. Quantum computing developments, while still nascent, require monitoring as potential long-term disruptors to current encryption and optimization approaches.

## Strategic Recommendations

Based on our comprehensive analysis, we recommend a phased strategic approach focusing on immediate stabilization, medium-term growth acceleration, and long-term market leadership positioning:

**Phase 1: Foundation Building (0-6 Months)**

1. **Digital Infrastructure Modernization** - Invest $50M in cloud-native architecture transformation to enable rapid scaling and reduce technical debt. This includes migrating legacy systems, implementing microservices architecture, and establishing DevOps capabilities.

2. **Talent Acquisition Acceleration** - Execute targeted acqui-hire strategy to acquire 3-4 small teams with specialized capabilities in AI/ML, customer experience, and platform development. Budget $30M for talent acquisition and retention programs.

3. **Customer Retention Optimization** - Implement predictive churn analytics and personalized retention programs targeting top 20% of customers by revenue. Expected impact: 25% reduction in churn, $15M annual revenue protection.

**Phase 2: Growth Acceleration (6-18 Months)**

1. **Geographic Market Entry** - Establish presence in two high-priority Asia-Pacific markets through joint ventures with local partners. Target markets with combined TAM of $8B and limited competitive presence.

2. **Platform Ecosystem Development** - Launch API-first platform enabling third-party integrations and developer ecosystem. Create $10M developer fund to incentivize innovation and adoption.

3. **Service Layer Monetization** - Introduce subscription-based service tiers with predictive analytics, consulting, and managed services offerings. Target 30% of revenue from services within 18 months.

**Phase 3: Market Leadership (18+ Months)**

1. **Strategic M&A Execution** - Acquire 2-3 complementary businesses to accelerate capability development and market access. Focus on AI/ML capabilities, vertical expertise, and geographic presence.

2. **Innovation Leadership** - Establish dedicated innovation lab with $25M annual budget for emerging technology exploration and venture investments. File 50+ patents in core technology areas.

3. **Ecosystem Orchestration** - Position as central platform connecting customers, partners, and developers. Create network effects driving competitive moat and switching costs.

## Conclusion

The market presents extraordinary opportunities for companies willing to embrace transformation and execute with discipline. Success requires balancing immediate operational excellence with long-term strategic positioning. Our analysis indicates that companies implementing recommended strategies can achieve market-leading positions within 24-36 months.

The window for action is narrowing as competitive intensity increases and market dynamics accelerate. Organizations must move decisively to capture emerging opportunities while building resilience against identified risks. The recommended strategic framework provides a roadmap for navigating complexity while maintaining focus on value creation.

Leadership alignment and organizational commitment will determine success. Companies that act decisively on these recommendations will be positioned to capture disproportionate value in the emerging market landscape. The time for incremental change has passed; bold action is required to secure competitive advantage in this transformative period.

*This report represents our best assessment based on comprehensive market analysis and industry expertise. We recommend quarterly review and adjustment of strategies based on market evolution and execution progress.*`,
    confidence: 0.88,
    tokens: 1250,
  },

  analysis: {
    content: `## Market Analysis Report

### Market Trends and Drivers

The current market landscape shows robust growth with a projected CAGR of 18.5% through 2028. Key trends driving this expansion include:

- **Digital Transformation Acceleration**: 78% of enterprises are increasing their digital investment budgets by an average of 35% year-over-year
- **AI/ML Integration**: Machine learning adoption has grown from 12% to 67% market penetration in the last 3 years
- **Sustainability Focus**: ESG compliance is now a top-3 priority for 82% of Fortune 500 companies in this sector
- **Remote-First Architecture**: Cloud infrastructure spending has increased by 250% since 2021

Primary growth drivers include regulatory changes favoring innovation, decreasing technology costs (down 40% over 5 years), and shifting consumer preferences toward digital-first experiences.

### Competitive Landscape Assessment

The competitive environment is characterized by consolidation among traditional players and disruption from new entrants:

**Market Leaders (Combined 65% market share):**
- AlphaCorp (28% share): Focus on enterprise solutions, $4.2B revenue
- BetaTech (22% share): Consumer-oriented products, aggressive pricing
- GammaIndustries (15% share): Niche specialization in financial services

**Emerging Competitors:**
- 15+ funded startups with combined $800M in venture backing
- Asian manufacturers entering Western markets with 30-40% cost advantages
- Big Tech companies expanding into adjacent verticals

Competitive intensity score: 8.2/10 (highly competitive)

### Growth Opportunities

Multiple expansion vectors present significant revenue potential:

1. **Geographic Expansion**: Asia-Pacific markets offer $12B TAM with only 8% current penetration
2. **Product Line Extensions**: Adjacent categories could add 40% to addressable market
3. **M&A Opportunities**: 23 potential acquisition targets identified with synergy potential of $200-500M
4. **Channel Partnerships**: Untapped B2B2C channels could drive 25% revenue growth
5. **Service Layer Monetization**: Recurring revenue opportunities through SaaS offerings (65% gross margins vs 40% for products)

Total identified opportunity value: $18.5B over 5 years

### Key Challenges and Risks

Several headwinds require strategic mitigation:

**Operational Challenges:**
- Supply chain constraints increasing lead times by 40-60%
- Talent shortage with 12,000 unfilled technical positions industry-wide
- Technology debt requiring $500M+ infrastructure modernization

**Market Risks:**
- Regulatory uncertainty in 3 major markets (EU, China, India)
- Currency fluctuations impacting 35% of revenue streams
- Increasing customer acquisition costs (up 125% in 3 years)

**Competitive Threats:**
- Platform disintermediation risk from major tech ecosystems
- Price pressure from low-cost alternatives reducing margins by 8-12%
- Innovation cycles shortening from 18 to 8 months

Risk severity matrix indicates 60% of risks are medium-to-high impact.

### Strategic Recommendations

Based on our comprehensive analysis, we recommend a three-pronged strategy:

**Immediate Actions (0-6 months):**
1. Accelerate digital platform development with $50M investment
2. Acquire talent through acqui-hires (target: 3 small teams)
3. Implement dynamic pricing to protect margins

**Medium-term Initiatives (6-18 months):**
1. Enter two new geographic markets via joint ventures
2. Launch subscription-based service tier
3. Consolidate supply chain with 30% vendor reduction

**Long-term Positioning (18+ months):**
1. Build ecosystem play with API-first architecture
2. Develop proprietary AI capabilities for differentiation
3. Consider strategic merger with complementary player

Expected outcome: 35% revenue growth, 500bps margin improvement, market share gain of 8-10 percentage points.`,
    confidence: 0.92,
    tokens: 850,
  },

  extraction: {
    content: `{
  "industry": "technology",
  "region": "North America",
  "marketSize": "$245.6B",
  "growthRate": "18.5%",
  "keyPlayers": ["AlphaCorp", "BetaTech", "GammaIndustries"],
  "segments": {
    "enterprise": { "size": "$156B", "growth": "22%" },
    "consumer": { "size": "$67B", "growth": "15%" },
    "government": { "size": "$22.6B", "growth": "12%" }
  },
  "trends": [
    "AI/ML adoption",
    "Cloud migration", 
    "Cybersecurity focus",
    "Sustainability initiatives"
  ]
}`,
    confidence: 0.88,
    tokens: 145,
  },

  default: {
    content: "This is a default mock response for testing purposes.",
    confidence: 0.75,
    tokens: 25,
  },
};

export async function callChatGPT(prompt, model) {
  // Simulate network latency
  await new Promise((resolve) =>
    setTimeout(resolve, 100 + Math.random() * 200)
  );

  // Determine which mock response to use based on prompt content
  let responseType = "default";

  if (
    prompt.toLowerCase().includes("report") ||
    prompt.toLowerCase().includes("executive") ||
    prompt.toLowerCase().includes("summary")
  ) {
    responseType = "report";
  } else if (
    prompt.toLowerCase().includes("analy") ||
    prompt.toLowerCase().includes("market") ||
    prompt.toLowerCase().includes("competitive") ||
    prompt.toLowerCase().includes("strategic")
  ) {
    responseType = "analysis";
  } else if (
    prompt.toLowerCase().includes("extract") ||
    prompt.toLowerCase().includes("data") ||
    prompt.toLowerCase().includes("parse")
  ) {
    responseType = "extraction";
  }

  const mockData = mockResponses[responseType];

  // Add some randomization to make it more realistic
  const confidenceVariance = (Math.random() - 0.5) * 0.1;
  const tokenVariance = Math.floor((Math.random() - 0.5) * 50);

  return {
    id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
    object: "chat.completion",
    created: Date.now(),
    model: model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: mockData.content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: Math.floor(prompt.length / 4),
      completion_tokens: mockData.tokens + tokenVariance,
      total_tokens:
        Math.floor(prompt.length / 4) + mockData.tokens + tokenVariance,
    },
    metadata: {
      confidence: Math.min(
        0.99,
        Math.max(0.7, mockData.confidence + confidenceVariance)
      ),
      processing_time: (100 + Math.random() * 200) / 1000,
      model_version: "2024-01",
      temperature: 0.7,
      top_p: 0.9,
    },
  };
}
