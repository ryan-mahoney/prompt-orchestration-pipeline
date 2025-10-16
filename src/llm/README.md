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

## Provider-Grouped Functions (Primary API)

The LLM layer exposes provider-grouped functions that map to named models in the configuration registry. This is the recommended approach for task development.

### `createLLM(options)`

Factory function that creates an interface with only provider-grouped functions.

```javascript
import { createLLM } from "../llm/index.js";

const llm = createLLM();

// Provider-grouped functions available:
await llm.openai.gpt4({ messages: [{ role: "user", content: "Hello!" }] });
await llm.openai.gpt4Turbo({ messages: [{ role: "user", content: "Hello!" }] });
await llm.openai.gpt5({ messages: [{ role: "user", content: "Hello!" }] });

await llm.deepseek.reasoner({
  messages: [{ role: "user", content: "Hello!" }],
});
await llm.deepseek.chat({ messages: [{ role: "user", content: "Hello!" }] });

await llm.anthropic.opus({ messages: [{ role: "user", content: "Hello!" }] });
await llm.anthropic.sonnet({ messages: [{ role: "user", content: "Hello!" }] });
```

### Task Context Usage

In task modules, `context.llm` provides only provider-grouped functions:

```javascript
// In a task module:
export default async function analysis(context) {
  const response = await context.llm.openai.gpt4({
    messages: [{ role: "user", content: "Analyze this data" }],
    temperature: 0.7,
  });

  return { analysis: response.content };
}
```

### Provider and Model Overrides

You can override the default provider and model:

```javascript
// Use OpenAI provider with custom model
await llm.deepseek.reasoner({
  messages: [{ role: "user", content: "Hello!" }],
  provider: "openai", // Override provider
  model: "gpt-4-custom", // Override model
});

// All other options are passed through
await llm.openai.gpt4({
  messages: [{ role: "user", content: "Hello!" }],
  temperature: 0.5,
  maxTokens: 1000,
  metadata: { taskId: "task-123" },
});
```

### Event Metadata

Provider-grouped functions automatically include alias metadata in events:

```javascript
import { getLLMEvents } from "../llm/index.js";

const events = getLLMEvents();
events.on("llm:request:complete", (data) => {
  console.log(data.metadata.alias); // "openai:gpt-4"
});
```

### Model Registry

The provider-grouped functions are generated from the model registry in your configuration. The default registry includes:

```json
{
  "llm": {
    "models": {
      "openai:gpt-4": { "provider": "openai", "model": "gpt-4" },
      "openai:gpt-4-turbo": { "provider": "openai", "model": "gpt-4-turbo" },
      "openai:gpt-5": { "provider": "openai", "model": "gpt-5-chat-latest" },
      "deepseek:reasoner": {
        "provider": "deepseek",
        "model": "deepseek-reasoner"
      },
      "deepseek:chat": { "provider": "deepseek", "model": "deepseek-chat" },
      "anthropic:opus": { "provider": "anthropic", "model": "claude-3-opus" },
      "anthropic:sonnet": {
        "provider": "anthropic",
        "model": "claude-3-sonnet"
      }
    }
  }
}
```

**Function Naming:**

- Registry aliases are converted to camelCase function names
- `openai:gpt-4-turbo` → `gpt4Turbo()`
- `deepseek:reasoner` → `reasoner()`

**Custom Registry:**
You can customize the registry in your `config.json`:

```json
{
  "llm": {
    "models": {
      "openai:custom": { "provider": "openai", "model": "gpt-4-custom" },
      "deepseek:fast": { "provider": "deepseek", "model": "deepseek-chat" }
    }
  }
}
```

This will generate:

- `llm.openai.custom()`
- `llm.deepseek.fast()`

## Legacy Functions (Deprecated)

The following functions are still available but deprecated in favor of provider-grouped functions:

### `chat(options)`

```javascript
import { chat } from "../llm/index.js";

const response = await chat({
  provider: "openai",
  model: "gpt-5-chat-latest",
  messages: [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "Hello!" },
  ],
  temperature: 0.7,
  maxTokens: 1000,
  metadata: { taskId: "task-123" },
});
```

### `complete(prompt, options)` (Deprecated)

```javascript
// DEPRECATED: Use provider-grouped functions instead
import { complete } from "../llm/index.js";

const response = await complete("What is 2+2?", {
  provider: "openai",
  model: "gpt-5-chat-latest",
});

// RECOMMENDED: Use provider-grouped function
import { createLLM } from "../llm/index.js";

const llm = createLLM();
const response = await llm.openai.gpt5({
  messages: [{ role: "user", content: "What is 2+2?" }],
});
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
