export const demoPipeline = {
  name: "AI Content Generation",
  tasks: [
    {
      id: "ingest",
      name: "ingest",
      config: { model: "gpt-4o", temperature: 0.2, maxTokens: 2000 },
    },
    {
      id: "analysis",
      name: "analysis",
      config: { model: "gpt-4.1", temperature: 0.3, maxTokens: 3000 },
    },
    {
      id: "draft",
      name: "draft",
      config: { model: "gpt-4.1", temperature: 0.7, maxTokens: 4000 },
    },
    {
      id: "validate",
      name: "validate",
      config: { model: "gpt-4o", temperature: 0.0, maxTokens: 1500 },
    },
  ],
};

const now = Date.now();
const earlier = (mins) => new Date(now - mins * 60_000).toISOString();

export const demoJobs = [
  {
    pipelineId: "run-001",
    name: "Blog: Transit Reliability",
    createdAt: earlier(14),
    status: "running",
    current: "draft",
    tasks: [
      {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(14),
        endedAt: earlier(13),
        executionTime: 60_000,
        attempts: 1,
        artifacts: [
          {
            filename: "sources.json",
            content: {
              urls: ["https://example.com/a", "https://example.com/b"],
            },
          },
        ],
      },
      {
        id: "analysis",
        name: "analysis",
        state: "completed",
        startedAt: earlier(13),
        endedAt: earlier(9),
        executionTime: 240_000,
        attempts: 1,
        artifacts: [
          {
            filename: "analysis.json",
            content: { themes: ["headways", "dwell"], gaps: ["APC"] },
          },
        ],
      },
      {
        id: "draft",
        name: "draft",
        state: "running",
        startedAt: earlier(9),
        attempts: 1,
      },
      {
        id: "validate",
        name: "validate",
        state: "pending",
        attempts: 0,
      },
    ],
  },
  {
    pipelineId: "run-002",
    name: "Whitepaper: Structured Hiring",
    createdAt: earlier(35),
    status: "error",
    current: "analysis",
    tasks: [
      {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(35),
        endedAt: earlier(33),
        executionTime: 120_000,
        attempts: 1,
        artifacts: [
          {
            filename: "sources.json",
            content: { driveIds: ["1ab", "2cd"], notes: "ok" },
          },
        ],
      },
      {
        id: "analysis",
        name: "analysis",
        state: "error",
        startedAt: earlier(33),
        endedAt: earlier(30),
        executionTime: 180_000,
        attempts: 2,
        refinementAttempts: 1,
        artifacts: [
          {
            filename: "error.json",
            content: {
              message: "Rate limit",
              hint: "Resume with cached context",
            },
          },
        ],
      },
      { id: "draft", name: "draft", state: "pending", attempts: 0 },
      { id: "validate", name: "validate", state: "pending", attempts: 0 },
    ],
  },
  {
    pipelineId: "run-003",
    name: "FAQ: Onboarding",
    createdAt: earlier(120),
    status: "completed",
    current: undefined,
    tasks: [
      {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(120),
        endedAt: earlier(118),
        executionTime: 120_000,
        attempts: 1,
      },
      {
        id: "analysis",
        name: "analysis",
        state: "completed",
        startedAt: earlier(118),
        endedAt: earlier(110),
        executionTime: 480_000,
        attempts: 1,
      },
      {
        id: "draft",
        name: "draft",
        state: "completed",
        startedAt: earlier(110),
        endedAt: earlier(100),
        executionTime: 600_000,
        attempts: 1,
        artifacts: [
          {
            filename: "draft.json",
            content: { sections: 7, readingTime: "6m" },
          },
        ],
      },
      {
        id: "validate",
        name: "validate",
        state: "completed",
        startedAt: earlier(100),
        endedAt: earlier(95),
        executionTime: 300_000,
        attempts: 1,
        artifacts: [
          {
            filename: "validation.json",
            content: { score: 0.93, notes: "Strong" },
          },
        ],
      },
    ],
  },
  {
    pipelineId: "run-004",
    name: "Case Study: Zero-Trust",
    createdAt: earlier(6),
    status: "running",
    current: "analysis",
    tasks: [
      {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(6),
        endedAt: earlier(5),
        executionTime: 60_000,
        attempts: 1,
      },
      {
        id: "analysis",
        name: "analysis",
        state: "running",
        startedAt: earlier(5),
        attempts: 1,
      },
      { id: "draft", name: "draft", state: "pending", attempts: 0 },
      { id: "validate", name: "validate", state: "pending", attempts: 0 },
    ],
  },
  {
    pipelineId: "run-005",
    name: "Guide: Hiring Scorecards",
    createdAt: earlier(240),
    status: "completed",
    current: undefined,
    tasks: [
      {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(240),
        endedAt: earlier(238),
        executionTime: 120_000,
        attempts: 1,
      },
      {
        id: "analysis",
        name: "analysis",
        state: "completed",
        startedAt: earlier(238),
        endedAt: earlier(232),
        executionTime: 360_000,
        attempts: 1,
      },
      {
        id: "draft",
        name: "draft",
        state: "completed",
        startedAt: earlier(232),
        endedAt: earlier(220),
        executionTime: 720_000,
        attempts: 1,
      },
      {
        id: "validate",
        name: "validate",
        state: "completed",
        startedAt: earlier(220),
        endedAt: earlier(215),
        executionTime: 300_000,
        attempts: 1,
        artifacts: [
          {
            filename: "validation.json",
            content: { score: 0.95, notes: "Excellent" },
          },
        ],
      },
    ],
  },
];
