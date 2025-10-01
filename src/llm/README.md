# LLM Abstraction Layer

This directory contains the unified LLM (Large Language Model) abstraction layer for the prompt orchestration pipeline.

## Purpose

The LLM layer provides a consistent interface for interacting with multiple AI providers (OpenAI, DeepSeek, Anthropic) while handling:

- Provider routing and API key validation
- Request/response formatting
- Token usage tracking and cost calculation
- Event-based metrics collection
- Error handling and retries
- Multi-turn conversation chains

## Architecture

```
src/
├── llm/
│   ├── index.js          ← Main LLM abstraction layer (THIS FILE)
│   └── README.md         ← This documentation
└── providers/
    ├── base.js           ← Base provider class
    ├── openai.js         ← OpenAI implementation
    ├── deepseek.js       ← DeepSeek implementation
    └── anthropic.js      ← Anthropic implementation
```

## Core Functions

### `chat(options)`

Main function for LLM interactions. Supports multiple providers and models.

```javascript
import { chat } from "../llm/index.js";

const response = await chat({
  provider: "openai", // or "deepseek", "anthropic"
  model: "gpt-5-chat-latest",
  messages: [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "Hello!" },
  ],
  temperature: 0.7,
  maxTokens: 1000,
  metadata: { taskId: "task-123" }, // Optional tracking data
});

console.log(response.content); // AI response text
console.log(response.usage); // Token usage stats
```

### `complete(prompt, options)`

Convenience function for simple single-turn completions.

```javascript
import { complete } from "../llm/index.js";

const response = await complete("What is 2+2?", {
  provider: "openai",
  model: "gpt-5-chat-latest",
});

console.log(response.content); // "4"
```

### `createLLM(options)`

Factory function to create a bound LLM interface with default settings.

```javascript
import { createLLM } from "../llm/index.js";

const llm = createLLM({
  defaultProvider: "openai",
  defaultModel: "gpt-5-chat-latest",
});

// Use the bound interface
const response = await llm.chat({
  messages: [{ role: "user", content: "Hello!" }],
});

// Or use convenience methods
const result = await llm.complete("What is AI?");
```

### `createChain()`

Create a multi-turn conversation chain.

```javascript
import { createChain } from "../llm/index.js";

const chain = createChain();

chain
  .addSystemMessage("You are a helpful math tutor")
  .addUserMessage("What is 2+2?");

const response1 = await chain.execute({ provider: "openai" });
console.log(response1.content); // "4"

chain.addUserMessage("What about 3+3?");
const response2 = await chain.execute({ provider: "openai" });
console.log(response2.content); // "6"

// Get full conversation history
const history = chain.getMessages();
```

### `withRetry(fn, args, maxRetries, backoffMs)`

Retry wrapper with exponential backoff.

```javascript
import { withRetry, chat } from "../llm/index.js";

const response = await withRetry(
  chat,
  [
    {
      provider: "openai",
      messages: [{ role: "user", content: "Hello!" }],
    },
  ],
  3, // max retries
  1000 // initial backoff in ms
);
```

### `parallel(fn, items, maxConcurrency)`

Execute multiple LLM requests in parallel with concurrency control.

```javascript
import { parallel, chat } from "../llm/index.js";

const prompts = ["What is AI?", "What is ML?", "What is DL?"];

const responses = await parallel(
  (prompt) =>
    chat({
      provider: "openai",
      messages: [{ role: "user", content: prompt }],
    }),
  prompts,
  5 // max concurrent requests
);
```

## Utility Functions

### `getAvailableProviders()`

Check which providers have API keys configured.

```javascript
import { getAvailableProviders } from "../llm/index.js";

const available = getAvailableProviders();
// { openai: true, deepseek: false, anthropic: true }
```

### `calculateCost(provider, model, usage)`

Calculate the cost of an LLM request based on token usage.

```javascript
import { calculateCost } from "../llm/index.js";

const cost = calculateCost("openai", "gpt-5-chat-latest", {
  promptTokens: 100,
  completionTokens: 50,
});

console.log(`Cost: $${cost.toFixed(4)}`);
```

### `estimateTokens(text)`

Rough estimation of token count for a text string.

```javascript
import { estimateTokens } from "../llm/index.js";

const tokens = estimateTokens("Hello, world!");
console.log(`Estimated tokens: ${tokens}`);
```

## Event System

The LLM layer emits events for monitoring and metrics collection.

```javascript
import { getLLMEvents } from "../llm/index.js";

const events = getLLMEvents();

// Listen for request start
events.on("llm:request:start", (data) => {
  console.log(`Request ${data.id} started`);
  console.log(`Provider: ${data.provider}, Model: ${data.model}`);
});

// Listen for successful completion
events.on("llm:request:complete", (data) => {
  console.log(`Request ${data.id} completed in ${data.duration}ms`);
  console.log(`Tokens: ${data.totalTokens}, Cost: $${data.cost}`);
});

// Listen for errors
events.on("llm:request:error", (data) => {
  console.error(`Request ${data.id} failed: ${data.error}`);
});
```

## Provider Configuration

### Environment Variables

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# DeepSeek
export DEEPSEEK_API_KEY="..."

# Anthropic
export ANTHROPIC_API_KEY="..."
```

### Supported Models

**OpenAI:**

- `gpt-5-chat-latest` (default)
- `gpt-5-chat-preview`
- `gpt-4-turbo-preview`
- `gpt-4`
- `gpt-3.5-turbo`

**DeepSeek:**

- `deepseek-reasoner` (default)
- `deepseek-chat`
- `deepseek-coder`

**Anthropic:**

- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`

## Error Handling

The LLM layer handles various error scenarios:

```javascript
try {
  const response = await chat({
    provider: "openai",
    messages: [{ role: "user", content: "Hello!" }],
  });
} catch (error) {
  if (error.status === 401) {
    console.error("Invalid API key");
  } else if (error.message?.includes("rate limit")) {
    console.error("Rate limit exceeded");
  } else {
    console.error("Request failed:", error.message);
  }
}
```

## Best Practices

1. **Use `createLLM()` for consistent settings:**

   ```javascript
   const llm = createLLM({ defaultProvider: "openai" });
   ```

2. **Add metadata for tracking:**

   ```javascript
   await chat({
     messages: [...],
     metadata: { taskId: "task-123", userId: "user-456" },
   });
   ```

3. **Use chains for multi-turn conversations:**

   ```javascript
   const chain = createChain();
   // Maintains conversation history automatically
   ```

4. **Implement retries for reliability:**

   ```javascript
   await withRetry(chat, [options], 3, 1000);
   ```

5. **Control concurrency for batch operations:**
   ```javascript
   await parallel(fn, items, 5); // Max 5 concurrent requests
   ```

## Testing

See `tests/llm.test.js` for comprehensive test coverage including:

- Provider routing and validation
- Token usage tracking
- Cost calculation
- Event emission
- Error handling
- Retry logic
- Parallel execution

## Migration from Legacy Code

If you're migrating from the old `src/providers/index.js` (now removed):

```javascript
// OLD (removed):
import { chat } from "../providers/index.js";

// NEW (correct):
import { chat } from "../llm/index.js";
```

All exports are compatible - this is a drop-in replacement.

## Related Documentation

- **Architecture:** `docs/architecture.md`
- **Provider Implementations:** `src/providers/`
- **Test Coverage:** `tests/llm.test.js`
- **Provider Fix Documentation:** `docs/providers-fix.md`
