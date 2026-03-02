# SpecOps Analysis: `providers`

**SOURCE_FILES:**
- `src/providers/base.js`
- `src/providers/anthropic.js`
- `src/providers/openai.js`
- `src/providers/gemini.js`
- `src/providers/deepseek.js`
- `src/providers/moonshot.js`
- `src/providers/zhipu.js`
- `src/providers/claude-code.js`
- `src/llm/index.js`

---

## 1. Purpose & Responsibilities

The providers module is the system's **LLM abstraction layer** — it provides a unified interface for sending chat-completion requests to multiple AI model providers and consuming their responses in a normalized format.

**Problem it solves:** The system needs to interact with at least seven different LLM APIs (Anthropic, OpenAI, Google Gemini, DeepSeek, Moonshot, Zhipu, and Claude Code CLI), each with its own request format, authentication mechanism, response shape, and error semantics. This module isolates those differences behind a consistent calling convention and response contract.

**Responsibilities:**

- **Provider adapters:** Each provider file (`anthropic.js`, `openai.js`, etc.) translates the system's common parameter set into the provider-specific HTTP request, sends it, and normalizes the response.
- **Shared utilities:** `base.js` supplies message extraction, retry classification, JSON parsing with fault tolerance, markdown fence stripping, error construction, and response-format validation.
- **Unified dispatcher:** `src/llm/index.js` acts as the central gateway. It resolves which provider to call, assembles arguments, invokes the appropriate adapter, normalizes usage metrics, emits telemetry events, computes cost estimates, and returns a uniform response object.
- **Named-model registry:** The LLM index exposes factory functions (`createLLM`, `createNamedModelsAPI`, `createHighLevelLLM`) that build provider-grouped callable objects from a centralized model configuration, allowing callers to invoke models by alias without knowing the underlying provider or model identifier.
- **Pipeline-level override:** `createLLMWithOverride` provides a Proxy-based mechanism to transparently redirect all model calls to a single provider/model pair at the pipeline level.

**Boundaries — what this module does NOT do:**

- It does not manage conversation history or multi-turn state beyond a single request-response cycle (the `createChain` helper is stateful but ephemeral and caller-managed).
- It does not decide which provider or model to use for a given task — that decision is made by callers (orchestrator, task runner) or by pipeline configuration.
- It does not persist responses, logs, or metrics to disk (except one debug write of messages to `/tmp/messages.log`).
- It does not handle streaming end-to-end for all providers — only DeepSeek supports streaming; others always return complete responses.

**Pattern:** This module implements the **Adapter pattern** (one adapter per provider) behind a **Strategy/Dispatcher** (the `chat()` function in `llm/index.js`), with an optional **Proxy-based decorator** for pipeline overrides.

---

## 2. Public Interface

### 2.1 Provider Adapters

Each adapter exports a single async function with a common calling convention and return shape.

#### `anthropicChat(options)` — `src/providers/anthropic.js`

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `messages` | Array of `{role, content}` | Yes | Conversation messages; system, user, and assistant roles |
| `model` | string | No (default `"claude-3-sonnet"`) | Anthropic model identifier |
| `temperature` | number | No (default `0.7`) | Sampling temperature |
| `maxTokens` | number | No (default `8192`) | Maximum response tokens |
| `responseFormat` | string or object | No (default `"json"`) | Must be a valid JSON format; enforced via `ensureJsonResponseFormat` |
| `topP` | number | No | Nucleus sampling parameter |
| `stop` | string or array | No | Stop sequences |
| `maxRetries` | number | No (default `3`) | Maximum retry attempts on transient errors |

**Returns:** `Promise<{ content: object, text: string, usage?: { prompt_tokens, completion_tokens, total_tokens }, raw: object }>`

- `content` — Parsed JSON object from the response.
- `text` — Raw text with markdown fences stripped.
- `usage` — Token counts normalized from Anthropic's `input_tokens`/`output_tokens` format. Present only if the API provides them.
- `raw` — Unmodified API response.

**Failure modes:** Throws on 401 (immediately, no retry). Throws `ProviderJsonParseError` if JSON parsing fails. Retries on network errors and HTTP 429/500/502/503/504 with exponential backoff.

---

#### `openaiChat(options)` — `src/providers/openai.js`

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `messages` | Array of `{role, content}` | Yes | Conversation messages |
| `model` | string | No (default `"gpt-5-chat-latest"`) | OpenAI model identifier |
| `temperature` | number | No | Sampling temperature (default `0.7` in classic path) |
| `maxTokens` | number | No | Maximum response tokens |
| `max_tokens` | number | No | Alternate name, destructured and discarded to prevent propagation via `...rest` |
| `responseFormat` | string or object | No (default `"json_object"`) | Supports `"json"`, `"json_object"`, `{ type: "json_object" }`, and `{ json_schema: ... }` |
| `seed` | number | No | Deterministic sampling seed (classic API only) |
| `stop` | string or array | No | Stop sequences (classic API only) |
| `topP` | number | No | Nucleus sampling (classic API only) |
| `frequencyPenalty` | number | No | Frequency penalty (classic API only) |
| `presencePenalty` | number | No | Presence penalty (classic API only) |
| `maxRetries` | number | No (default `3`) | Maximum retry attempts |

**API routing:** Uses the Responses API for models matching `/^gpt-5/i`; falls back to Chat Completions API for all others. If the Responses API returns an "unsupported" error, automatically retries with the Chat Completions API.

**Returns:** Same shape as `anthropicChat`. In non-JSON mode (when `isJsonMode` is false), `content` is the raw text string rather than parsed JSON.

**Usage estimation:** For the Responses API path, usage is approximated at ~4 characters per token rather than returned by the API.

**Failure modes:** Throws on 401 or API-key-related errors immediately. Falls back from Responses to Classic API on "not supported"/"unsupported" errors. Retries transient errors with exponential backoff.

---

#### `geminiChat(options)` — `src/providers/gemini.js`

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `messages` | Array of `{role, content}` | Yes | Conversation messages |
| `model` | string | No (default `"gemini-2.5-flash"`) | Google Gemini model identifier |
| `temperature` | number | No (default `0.7`) | Sampling temperature |
| `maxTokens` | number | No | Maximum output tokens |
| `responseFormat` | string or object | Yes (enforced) | Must be a valid JSON format |
| `topP` | number | No | Top-p sampling |
| `frequencyPenalty` | number | No | Accepted but not sent to the API (destructured and unused) |
| `presencePenalty` | number | No | Accepted but not sent to the API (destructured and unused) |
| `stop` | string | No | Single stop sequence |
| `maxRetries` | number | No (default `3`) | Maximum retry attempts |

**Distinctive behavior:** Constructs requests using Gemini's `contents` / `systemInstruction` / `generationConfig` format. Disables all safety settings (`BLOCK_NONE`). Supports a `json_schema` response format by embedding the schema in the system instruction. Normalizes usage from Gemini's `usageMetadata` field (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`).

**Returns:** Same shape. `content` is parsed JSON if a `responseFormat` is provided; otherwise the raw text.

---

#### `deepseekChat(options)` — `src/providers/deepseek.js`

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `messages` | Array of `{role, content}` | Yes | Conversation messages |
| `model` | string | No (default `"deepseek-chat"`) | DeepSeek model identifier |
| `temperature` | number | No (default `0.7`) | Sampling temperature |
| `maxTokens` | number | No | Maximum response tokens |
| `responseFormat` | string or object | No (default `"json_object"`) | JSON format indicator |
| `topP` | number | No | Top-p sampling |
| `frequencyPenalty` | number | No | Frequency penalty |
| `presencePenalty` | number | No | Presence penalty |
| `stop` | string or array | No | Stop sequences |
| `stream` | boolean | No (default `false`) | Enable streaming mode |
| `maxRetries` | number | No (default `3`) | Maximum retry attempts |

**Distinctive behavior:** Only provider that supports **streaming mode**. When `stream` is true, returns an async generator yielding `{ content: string }` chunks parsed from Server-Sent Events. JSON response format is disabled when streaming. Does not call `ensureJsonResponseFormat`; instead determines JSON mode by inspecting `responseFormat` value locally.

**Returns (non-streaming):** `{ content: object|string, usage: object, raw: object }` — note: no `text` field, unlike other providers.

---

#### `moonshotChat(options)` — `src/providers/moonshot.js`

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `messages` | Array of `{role, content}` | Yes | Conversation messages |
| `model` | string | No (default `"kimi-k2.5"`) | Moonshot model identifier |
| `maxTokens` | number | No (default `32768`) | Maximum response tokens |
| `thinking` | string | No (default `"enabled"`) | `"enabled"` or `"disabled"` — controls extended thinking mode |
| `maxRetries` | number | No (default `3`) | Maximum retry attempts |

**Distinctive behavior:** Does not accept `temperature`, `topP`, `frequencyPenalty`, or `presencePenalty` (kimi-k2.5 restriction). Always uses `json_object` response format. Includes a `thinking` parameter for extended reasoning mode. On content-filter errors (HTTP 400 with "high risk"/"rejected"), **falls back to DeepSeek** (using `deepseek-reasoner` if thinking was enabled, `deepseek-chat` otherwise) — but only if `DEEPSEEK_API_KEY` is configured. Does not retry `ProviderJsonParseError`.

**Returns:** `{ content: object, usage: object, raw: object }` — no `text` field.

---

#### `zhipuChat(options)` — `src/providers/zhipu.js`

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `messages` | Array of `{role, content}` | Yes | Conversation messages |
| `model` | string | No (default `"glm-4-plus"`) | Zhipu model identifier |
| `temperature` | number | No (default `0.7`) | Sampling temperature |
| `maxTokens` | number | No (default `8192`) | Maximum response tokens |
| `responseFormat` | string or object | No (default `"json"`) | Must be a valid JSON format |
| `topP` | number | No | Top-p sampling |
| `stop` | string or array | No | Stop sequences |
| `maxRetries` | number | No (default `3`) | Maximum retry attempts |

**Returns:** Same shape as `anthropicChat`.

**Behavior:** Structurally very similar to the Anthropic adapter. Uses OpenAI-compatible chat completions format against the Zhipu API endpoint. Supports JSON schema enforcement via system instruction injection (same approach as Gemini).

---

#### `claudeCodeChat(options)` — `src/providers/claude-code.js`

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `messages` | Array of `{role, content}` | Yes | Conversation messages |
| `model` | string | No (default `"sonnet"`) | Claude Code model name: `sonnet`, `opus`, or `haiku` |
| `maxTokens` | number | No | Maximum response tokens |
| `maxTurns` | number | No (default `1`) | Maximum conversation turns |
| `responseFormat` | string or object | No (default `"json"`) | Must be a valid JSON format |
| `maxRetries` | number | No (default `3`) | Maximum retry attempts |

**Distinctive behavior:** Invokes the `claude` CLI as a child process rather than making HTTP requests. Uses `--output-format json` to get structured output. Parses the CLI's JSON envelope, then extracts and re-parses the inner text content. Usage is always reported as zeros (Claude Code is a subscription service).

#### `isClaudeCodeAvailable()` — `src/providers/claude-code.js`

**Purpose:** Synchronously checks whether the `claude` CLI is installed and runnable.
**Parameters:** None.
**Returns:** `boolean` — `true` if `claude --version` exits with code 0 within 5 seconds.

---

### 2.2 Shared Utilities — `src/providers/base.js`

| Export | Type | Purpose |
|---|---|---|
| `extractMessages(messages)` | function | Splits a message array into `systemMsg` (string), `userMsg` (joined string), `userMessages` (array), and `assistantMessages` (array) |
| `isRetryableError(err)` | function | Returns `true` if the error represents a transient condition (network errors, HTTP 429/500/502/503/504) |
| `sleep(ms)` | async function | Promise-based delay |
| `stripMarkdownFences(text)` | function | Removes markdown code fences (`` ```lang ... ``` ``) from text |
| `tryParseJSON(text)` | function | Attempts JSON parsing with progressive fallback: raw parse, fence-stripped parse, then substring extraction of first `{...}` or `[...]` |
| `createProviderError(status, errorBody, fallbackMessage)` | function | Creates an `Error` instance with `status`, `code`, and `details` properties from an HTTP error response |
| `ensureJsonResponseFormat(responseFormat, providerName)` | function | Validates that the response format is a recognized JSON format; throws `ProviderJsonModeError` if not |
| `ProviderJsonModeError` | class (extends Error) | Error for missing or invalid JSON response format configuration. Has `provider` property |
| `ProviderJsonParseError` | class (extends Error) | Error for failed JSON parsing of provider responses. Has `provider`, `model`, and `sample` properties |

---

### 2.3 LLM Gateway — `src/llm/index.js`

| Export | Type | Purpose |
|---|---|---|
| `chat(options)` | async function | Central dispatcher — routes to the correct provider adapter, normalizes response, emits telemetry events, returns uniform result |
| `complete(prompt, options)` | async function | Convenience wrapper — sends a single user message via `chat()` using the configured default provider |
| `createLLM()` | function | Returns a nested object of provider-grouped callable functions built from the model configuration registry |
| `createNamedModelsAPI()` | function | Alias for `createLLM()` |
| `createHighLevelLLM(options)` | function | Returns an object combining high-level methods (`chat`, `complete`, `createChain`, `withRetry`, `parallel`, `getAvailableProviders`) with provider-grouped functions |
| `createLLMWithOverride(override)` | function | Returns a Proxy-wrapped LLM object that redirects all calls to a single override provider/model |
| `createChain()` | function | Returns a stateful conversation chain object with `addSystemMessage`, `addUserMessage`, `addAssistantMessage`, `getMessages`, `clear`, and `execute` methods |
| `withRetry(fn, args, options)` | async function | Generic retry wrapper with exponential backoff; skips retry on 401 errors |
| `parallel(workerFn, items, concurrency)` | async function | Executes an async worker function over an array of items with bounded concurrency |
| `getLLMEvents()` | function | Returns the global `EventEmitter` instance used for LLM telemetry |
| `registerMockProvider(provider)` | function | Registers a mock provider for testing/demo |
| `getAvailableProviders()` | function | Returns an object mapping provider names to boolean availability based on environment variables |
| `estimateTokens(text)` | function | Estimates token count as `ceil(text.length / 4)` |
| `calculateCost(provider, model, usage)` | function | Computes dollar cost from token usage and model pricing configuration |

#### `chat(options)` — Detailed Signature

| Parameter | Type | Required | Semantic Meaning |
|---|---|---|---|
| `provider` | string | Yes | Provider identifier: `"openai"`, `"anthropic"`, `"deepseek"`, `"gemini"`, `"zhipu"`, `"claudecode"`, `"moonshot"`, `"mock"` |
| `model` | string | No | Model identifier; falls back to provider-specific default from `MODEL_CONFIG` |
| `messages` | Array of `{role, content}` | No (default `[]`) | Conversation messages |
| `temperature` | number | No | Sampling temperature |
| `maxTokens` | number | No | Maximum response tokens |
| `metadata` | object | No (default `{}`) | Arbitrary metadata passed through to telemetry events |
| `topP` | number | No | Nucleus sampling |
| `frequencyPenalty` | number | No | Frequency penalty |
| `presencePenalty` | number | No | Presence penalty |
| `stop` | string or array | No | Stop sequences |
| `responseFormat` | string or object | No | Response format; some providers infer JSON mode from message content if not provided |
| `stream` | boolean | No (default `false`) | Streaming mode (DeepSeek only) |

**Returns:** `Promise<{ content: object|string, usage: { promptTokens, completionTokens, totalTokens }, raw?: object }>` — note the usage field uses camelCase (`promptTokens`) at this level, normalized from the snake_case (`prompt_tokens`) returned by individual providers.

**Events emitted:**
- `llm:request:start` — `{ id, provider, model, metadata, timestamp }`
- `llm:request:complete` — `{ id, provider, model, duration, promptTokens, completionTokens, totalTokens, cost, metadata, timestamp }`
- `llm:request:error` — `{ id, provider, model, duration, error, metadata, timestamp }`

---

## 3. Data Models & Structures

### 3.1 Message Object

| Field | Type | Optionality | Semantic Meaning |
|---|---|---|---|
| `role` | string | Required | One of `"system"`, `"user"`, `"assistant"` |
| `content` | string | Required | The text content of the message |

**Lifecycle:** Created by callers (orchestrator, task runner). Consumed and sometimes re-shaped by `extractMessages()`. Not persisted by this module.

**Ownership:** Owned by callers; this module reads but does not mutate messages (except `createChain` which builds its own internal array).

### 3.2 Provider Response (Adapter Level)

| Field | Type | Optionality | Semantic Meaning |
|---|---|---|---|
| `content` | object or string | Required | Parsed JSON result (in JSON mode) or raw text string (in text mode) |
| `text` | string | Varies by provider | Raw text response with markdown fences stripped. Present in Anthropic, OpenAI, Gemini, Zhipu, Claude Code adapters. Absent in DeepSeek, Moonshot |
| `usage` | object | Optional | `{ prompt_tokens, completion_tokens, total_tokens }` — snake_case at adapter level |
| `raw` | object | Optional | Unmodified API response for debugging/inspection |

### 3.3 Normalized Response (Gateway Level)

| Field | Type | Optionality | Semantic Meaning |
|---|---|---|---|
| `content` | object or string | Required | From provider adapter |
| `usage` | object | Required | `{ promptTokens, completionTokens, totalTokens }` — camelCase, always present (estimated if API doesn't provide) |
| `raw` | object | Optional | From provider adapter |

### 3.4 Streaming Chunk (DeepSeek only)

| Field | Type | Semantic Meaning |
|---|---|---|
| `content` | string | A text fragment from the streaming response |

Yielded by the async generator returned from `deepseekChat` when `stream: true`.

### 3.5 LLM Telemetry Event

Events are emitted on the global `EventEmitter` with the following shapes:

**`llm:request:start`:**

| Field | Type | Semantic Meaning |
|---|---|---|
| `id` | string | Unique request identifier (`req_{timestamp}_{random}`) |
| `provider` | string | Provider name |
| `model` | string | Model identifier |
| `metadata` | object | Caller-supplied metadata |
| `timestamp` | string | ISO 8601 timestamp |

**`llm:request:complete`:**

All fields from `start` plus: `duration` (ms), `promptTokens`, `completionTokens`, `totalTokens`, `cost` (number).

**`llm:request:error`:**

All fields from `start` plus: `duration` (ms), `error` (string message).

### 3.6 Provider Availability Map

Returned by `getAvailableProviders()`:

| Field | Type | How Determined |
|---|---|---|
| `openai` | boolean | `!!process.env.OPENAI_API_KEY` |
| `deepseek` | boolean | `!!process.env.DEEPSEEK_API_KEY` |
| `anthropic` | boolean | `!!process.env.ANTHROPIC_API_KEY` |
| `gemini` | boolean | `!!process.env.GEMINI_API_KEY` |
| `zhipu` | boolean | `!!process.env.ZHIPU_API_KEY` |
| `claudecode` | boolean | `isClaudeCodeAvailable()` — synchronous CLI check |
| `moonshot` | boolean | `!!process.env.MOONSHOT_API_KEY` |
| `mock` | boolean | `!!mockProviderInstance` |

---

## 4. Behavioral Contracts

### Preconditions

- The appropriate API key environment variable must be set for the chosen provider (or `claude` CLI must be installed for `claudecode`).
- Most providers require `responseFormat` to be a valid JSON format (enforced by `ensureJsonResponseFormat`). The exception is DeepSeek and Moonshot, which do not call `ensureJsonResponseFormat` and determine JSON mode internally.
- OpenAI requires the `openai` npm package to be installed (it uses the SDK client, not raw `fetch`).

### Postconditions

- On success, every provider adapter returns an object with at minimum a `content` field containing parsed JSON or raw text.
- The `chat()` gateway always returns a `usage` object (estimated if not provided by the API).
- Telemetry events are always emitted — `llm:request:start` before the call and either `llm:request:complete` or `llm:request:error` after.

### Invariants

- Provider adapters never mutate the input `messages` array.
- Markdown code fences are always stripped before JSON parsing is attempted.
- Authentication errors (HTTP 401) are never retried.
- `ProviderJsonParseError` is never retried by provider adapters (except Moonshot which explicitly checks for this). The gateway `chat()` function does not add its own retry layer.

### Ordering Guarantees

- Retry attempts proceed sequentially with exponential backoff (`2^attempt * 1000ms`).
- The `parallel()` utility preserves result ordering (results array matches items array by index).

### Concurrency Behavior

- Each adapter function is independently callable and stateless (except OpenAI's lazy-initialized singleton client).
- The `parallel()` helper limits concurrent execution to a configurable concurrency cap (default 5).
- The OpenAI client (`client` variable in `openai.js`) is a module-level singleton, lazily initialized on first use. This is thread-safe in JavaScript's single-threaded model but means all concurrent OpenAI calls share the same client instance.

---

## 5. State Management

### In-Memory State

| State | Location | Lifecycle | Description |
|---|---|---|---|
| `client` | `openai.js` module scope | Lazily created on first `getClient()` call, never destroyed | OpenAI SDK client singleton |
| `mockProviderInstance` | `llm/index.js` module scope | Set via `registerMockProvider()` or auto-created in test mode | Mock provider for testing |
| `llmEvents` | `llm/index.js` module scope | Created at module load, lives for process lifetime | EventEmitter for telemetry |
| Chain messages | Returned `createChain()` object | Managed by caller | Conversation history for chaining |

### Persisted State

- **Debug log:** `chat()` writes the full messages payload to `/tmp/messages.log` on every call. This is unconditional (not gated by a debug flag).

### Shared State

- The `llmEvents` EventEmitter is shared globally via `getLLMEvents()`. Any module can subscribe to LLM telemetry events.
- The `mockProviderInstance` is shared globally and can be set by any module calling `registerMockProvider()`.

### Crash Recovery

There is no crash recovery mechanism. If the process crashes mid-request, the API call may or may not have been received by the provider. No local state needs recovery.

---

## 6. Dependencies

### 6.1 Internal Dependencies

| Module | What's Used | Nature | Coupling |
|---|---|---|---|
| `src/core/logger.js` | `createLogger` | Runtime import | Low — only used for diagnostic logging; easily replaceable |
| `src/core/config.js` | `getConfig` | Runtime import | Medium — used in `llm/index.js` to determine `defaultProvider`; skipped in test mode |
| `src/config/models.js` | `MODEL_CONFIG`, `DEFAULT_MODEL_BY_PROVIDER`, `aliasToFunctionName` | Runtime import | High — the model registry is central to how named-model functions and cost calculation work |
| `src/providers/deepseek.js` | `deepseekChat` | Runtime import from `moonshot.js` | Medium — Moonshot has a hard dependency on DeepSeek as a fallback provider |

### 6.2 External Dependencies

| Package | What It Provides | How Used | Replaceability |
|---|---|---|---|
| `openai` (npm) | OpenAI SDK client | Used in `openai.js` for both Responses API and Chat Completions API | Localized — only `openai.js` depends on it; could be replaced with raw `fetch` |
| `node:events` | `EventEmitter` | Used in `llm/index.js` for the telemetry event bus | Localized — standard Node.js API |
| `node:fs` | `writeFileSync` | Used in `llm/index.js` for debug logging to `/tmp/messages.log` | Trivially removable |
| `node:child_process` | `spawn`, `spawnSync` | Used in `claude-code.js` to invoke the CLI | Localized to one file |

All providers except OpenAI use the global `fetch` API directly (no SDK).

### 6.3 System-Level Dependencies

**Environment variables:**

| Variable | Provider | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | Yes for Anthropic |
| `OPENAI_API_KEY` | OpenAI | Yes for OpenAI |
| `OPENAI_ORGANIZATION` | OpenAI | No |
| `OPENAI_BASE_URL` | OpenAI | No |
| `GEMINI_API_KEY` | Gemini | Yes for Gemini |
| `GEMINI_BASE_URL` | Gemini | No (default: `https://generativelanguage.googleapis.com/v1beta`) |
| `DEEPSEEK_API_KEY` | DeepSeek | Yes for DeepSeek |
| `MOONSHOT_API_KEY` | Moonshot | Yes for Moonshot |
| `ZHIPU_API_KEY` | Zhipu | Yes for Zhipu |
| `NODE_ENV` / `VITEST` | Test detection | No — used to skip config checks in test mode |

**External services (network):**

| Provider | Endpoint |
|---|---|
| Anthropic | `https://api.anthropic.com/v1/messages` |
| OpenAI | Configurable via `OPENAI_BASE_URL` or OpenAI SDK defaults |
| Gemini | Configurable via `GEMINI_BASE_URL` (default: `https://generativelanguage.googleapis.com/v1beta`) |
| DeepSeek | `https://api.deepseek.com/chat/completions` |
| Moonshot | `https://api.moonshot.ai/v1/chat/completions` |
| Zhipu | `https://api.z.ai/api/paas/v4/chat/completions` |
| Claude Code | Local `claude` CLI binary |

**OS-level:** Claude Code provider requires the `claude` CLI to be in the system PATH. It spawns child processes via `spawn`/`spawnSync`.

---

## 7. Side Effects & I/O

### Network

Every provider adapter (except Claude Code) makes outbound HTTPS requests to their respective API endpoints. All are asynchronous. Error handling includes retry with exponential backoff.

### File System

- `chat()` in `llm/index.js` writes to `/tmp/messages.log` synchronously on every invocation (using `fs.writeFileSync`). This is a debug artifact.

### Process Management

- `claude-code.js` spawns the `claude` CLI as a child process (`spawn`). stdin is ignored; stdout and stderr are collected. The promise resolves on process exit with code 0 or rejects otherwise.
- `isClaudeCodeAvailable()` uses `spawnSync` with a 5-second timeout to check CLI availability.

### Logging & Observability

All adapters and the gateway use `createLogger` to emit diagnostic logs at `log`, `error`, and `warn` levels. Logged information includes: call parameters, attempt counts, response lengths, usage metrics, and error details.

### Timing & Scheduling

- Exponential backoff sleep between retry attempts: `2^attempt * 1000ms` in all adapters.
- `withRetry()` in `llm/index.js` uses configurable backoff: `backoffMs * 2^attempt` (default `backoffMs = 100`).
- `chat()` tracks request duration via `Date.now()` for telemetry.

---

## 8. Error Handling & Failure Modes

### Error Categories

| Category | Examples | Handling |
|---|---|---|
| Authentication | HTTP 401, "API key" errors | Thrown immediately, never retried |
| Rate limiting | HTTP 429 | Retried with exponential backoff |
| Server errors | HTTP 500, 502, 503, 504 | Retried with exponential backoff |
| Network errors | `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNREFUSED`, timeout | Retried with exponential backoff |
| JSON parse failure | Response is not valid JSON | Throws `ProviderJsonParseError` — not retried by most adapters; Moonshot explicitly does not retry it |
| JSON format misconfiguration | `responseFormat` is missing or invalid | Throws `ProviderJsonModeError` — not retried |
| Content filtering | HTTP 400 with "high risk"/"rejected" (Moonshot only) | Falls back to DeepSeek if API key available |
| API unsupported | "not supported"/"unsupported" (OpenAI Responses API only) | Falls back to Chat Completions API |
| Provider unavailable | API key not set, CLI not found | Throws immediately |

### Propagation Strategy

All errors propagate as thrown exceptions (rejected promises). The gateway `chat()` catches errors to emit the `llm:request:error` telemetry event, then re-throws.

### Recovery Behavior

- **Retry with backoff:** Transient errors are retried up to `maxRetries` times (default 3) with exponential backoff.
- **Fallback provider:** Moonshot falls back to DeepSeek on content-filter errors.
- **Fallback API:** OpenAI falls back from Responses API to Chat Completions API on unsupported errors.
- **No circuit breaking or fail-fast across calls** — each call is independent.

### Partial Failure

Not applicable at the adapter level (each call is atomic — one request, one response). For `parallel()`, if any item fails, `Promise.all` will reject; there is no partial result collection.

### User/Operator Visibility

Errors surface as thrown exceptions to the caller (typically the task runner or orchestrator). The `llm:request:error` event is emitted for any subscriber. Logger output captures error details.

---

## 9. Integration Points & Data Flow

### Upstream (Who Calls This Module)

- **Task runner / Orchestrator** — calls `chat()` or named-model functions via the LLM object to execute pipeline tasks.
- **`createLLMWithOverride`** is called by the pipeline runner when a pipeline specifies an LLM override.
- **Task analysis modules** may call `chat()` or `complete()` for analysis tasks.
- **Tests** use `registerMockProvider()` and `createHighLevelLLM()`.

### Downstream (What This Module Calls)

- External LLM APIs via HTTP (`fetch`) or SDK (`openai` package).
- `claude` CLI via child process spawning.
- `MODEL_CONFIG` from `src/config/models.js` for model metadata and pricing.
- `getConfig()` from `src/core/config.js` for default provider.

### Data Transformation

1. **Input:** Caller provides `messages` array with `{role, content}` objects.
2. **Message extraction:** `extractMessages()` splits into `systemMsg` (string), `userMsg` (joined string), `userMessages` (array), `assistantMessages` (array).
3. **Provider-specific request:** Each adapter transforms extracted messages into the provider's request format (e.g., Anthropic uses `system` + `messages[{role: "user", content}]`; Gemini uses `contents[{parts}]` + `systemInstruction`).
4. **JSON enforcement:** Some providers inject "You must output strict JSON only" into the system message.
5. **Response extraction:** Raw API response is parsed; text content is extracted from provider-specific envelope (e.g., Anthropic's `content[].text`, OpenAI's `choices[0].message.content`, Gemini's `candidates[0].content.parts[0].text`).
6. **Fence stripping:** Markdown code fences are removed.
7. **JSON parsing:** `tryParseJSON()` attempts to parse the cleaned text.
8. **Usage normalization:** Provider-specific usage metrics are mapped to a common `{prompt_tokens, completion_tokens, total_tokens}` shape at the adapter level, then to `{promptTokens, completionTokens, totalTokens}` at the gateway level.
9. **Cost calculation:** `calculateCost()` uses model pricing from `MODEL_CONFIG`.

### Control Flow — Primary Use Case (non-streaming)

1. `chat()` is called with `{provider, model, messages, ...}`.
2. Provider availability is checked via `getAvailableProviders()`.
3. `llm:request:start` event is emitted.
4. Provider-specific argument assembly (merging defaults, mapping parameter names).
5. Provider adapter is called (e.g., `anthropicChat()`).
6. Adapter: Extract messages → build request body → send HTTP request → retry on transient errors → extract text → strip fences → parse JSON → normalize usage → return.
7. `chat()` normalizes usage to camelCase, calculates cost, emits `llm:request:complete`.
8. Returns `{ content, usage, raw }`.

### System-Wide Patterns

- **Event bus participation:** The `llmEvents` emitter is the telemetry mechanism. Other modules (e.g., metrics collectors, status writers) can subscribe to track LLM usage.
- **Plugin-like architecture:** The named-model functions generated by `buildProviderFunctions` effectively create a registry of callable model endpoints that can be used by name throughout the system.
- **Proxy pattern:** `createLLMWithOverride` uses JavaScript `Proxy` to intercept all method access on the LLM object, providing transparent override without modifying the original LLM instance.

---

## 10. Edge Cases & Implicit Behavior

### Default Values That Shape Behavior

- **Anthropic:** `model` defaults to `"claude-3-sonnet"`, `temperature` to `0.7`, `maxTokens` to `8192`, `responseFormat` to `"json"`.
- **OpenAI:** `model` defaults to `"gpt-5-chat-latest"`, `responseFormat` to `"json_object"`. Temperature defaults to `0.7` in the Classic API path but is not set in the Responses API path.
- **Gemini:** `model` defaults to `"gemini-2.5-flash"`, `temperature` to `0.7`.
- **DeepSeek:** `model` defaults to `"deepseek-chat"`, `temperature` to `0.7`, `responseFormat` to `"json_object"`.
- **Moonshot:** `model` defaults to `"kimi-k2.5"`, `maxTokens` to `32768`, `thinking` to `"enabled"`.
- **Zhipu:** `model` defaults to `"glm-4-plus"`, `temperature` to `0.7`, `maxTokens` to `8192`, `responseFormat` to `"json"`.
- **Claude Code:** `model` defaults to `"sonnet"`, `maxTurns` to `1`, `responseFormat` to `"json"`.

### JSON Format Inference

For OpenAI, DeepSeek, Gemini, and Moonshot, when `responseFormat` is `undefined`/`null`/`""` at the gateway level, the system checks the first two messages for the word "json" (case-insensitive). If found, it infers `"json_object"` format. This means **message content can implicitly trigger JSON mode**.

### OpenAI `max_tokens` Parameter Handling

The `openaiChat` function destructures both `maxTokens` and `max_tokens` from options. The `max_tokens` parameter is explicitly destructured to prevent it from leaking through `...rest` into the request body. In the Responses API path, `max_output_tokens` defaults to `maxTokens ?? max_tokens ?? 25000`.

### OpenAI Responses API Fallback

The Responses API is used only for models matching `/^gpt-5/i`. If the Responses API returns an error whose message contains "not supported" or "unsupported", the adapter silently retries using the Chat Completions API — within the same retry attempt, not consuming an additional retry.

### Moonshot Content Filter Fallback

On HTTP 400 with "high risk" or "rejected" in the error message, Moonshot falls back to DeepSeek immediately (without retrying Moonshot). The fallback model depends on the `thinking` parameter: `"deepseek-reasoner"` if thinking was enabled, `"deepseek-chat"` otherwise.

### OpenAI Responses API Usage Approximation

The Responses API path in `openaiChat` does not receive real usage data from the API. Instead, it estimates tokens at ~4 characters per token for both prompt and completion.

### Debug File Write

`chat()` unconditionally writes all messages to `/tmp/messages.log` on every invocation. This is not gated by any environment variable or debug flag.

### Mock Provider Auto-Registration

In test mode (`NODE_ENV === "test"` or `VITEST === "true"`), if the default provider is `"mock"` and no mock provider has been registered, one is automatically created that returns `"Mock response for testing"` with fixed usage numbers (100/200/300 tokens).

### `createLLMWithOverride` Built-in Method Guard

The proxy skips interception for methods named `toJSON`, `toString`, `valueOf`, `then`, `catch`, `finally`, and `constructor` to prevent spurious API calls during serialization or promise resolution.

### DeepSeek Streaming JSON Suppression

When `stream` is `true` in DeepSeek, `response_format` is not included in the request body, because the DeepSeek API does not support JSON mode with streaming.

### Gemini Safety Settings

All four Gemini safety categories (`HARM_CATEGORY_HARASSMENT`, `HARM_CATEGORY_HATE_SPEECH`, `HARM_CATEGORY_SEXUALLY_EXPLICIT`, `HARM_CATEGORY_DANGEROUS_CONTENT`) are unconditionally set to `BLOCK_NONE`.

### `parallel()` Concurrency Bug

The `parallel()` function has a subtle concurrency control issue: after `Promise.race` resolves, it removes the promise that was passed to `push` rather than the one that actually resolved. The `findIndex` looks for `p === promise`, where `promise` is the current iteration's promise, not necessarily the one that won the race. This means the `executing` array may not shrink correctly, potentially allowing more than `concurrency` simultaneous executions.

---

## 11. Open Questions & Ambiguities

1. **Debug file write in production:** The `fs.writeFileSync("/tmp/messages.log", ...)` call in `chat()` appears to be a development artifact. It writes all LLM messages (including potentially sensitive prompt content) to a world-readable temp file on every call. It is unclear whether this is intentional for production use.

2. **Inconsistent `text` field presence:** Anthropic, OpenAI, Gemini, Zhipu, and Claude Code adapters include a `text` field in their response. DeepSeek and Moonshot do not. The gateway `chat()` does not normalize this — it passes through whatever the adapter returns. Callers that rely on `text` will fail silently for some providers.

3. **Inconsistent JSON format enforcement:** Anthropic, Gemini, Zhipu, and Claude Code call `ensureJsonResponseFormat()` and reject requests without a valid JSON format. OpenAI, DeepSeek, and Moonshot do not, instead determining JSON mode internally. The gateway applies JSON format inference for some providers but not others (Anthropic, Zhipu, Claude Code get the raw `responseFormat` from the caller without inference).

4. **Gemini `frequencyPenalty` / `presencePenalty`:** These parameters are destructured from options but never included in the request body. It is unclear whether this is intentional omission (Gemini doesn't support them) or an oversight.

5. **Anthropic hardcoded API version:** The Anthropic adapter uses `"anthropic-version": "2023-06-01"` as a hardcoded header. There is no mechanism to update this without code changes.

6. **`parallel()` error handling:** If any item in a `parallel()` batch throws, the entire batch fails via `Promise.all`. There is no mechanism for partial success or error collection.

7. **Token estimation accuracy:** The `estimateTokens` function uses a fixed 4-character-per-token ratio, which is a rough approximation. Different models have different tokenizers with different ratios. This affects cost calculations when the API does not return usage data.

8. **Moonshot `maxTokens` passed to `fallbackToDeepSeek` but not used:** The `fallbackToDeepSeek` function receives `maxTokens` in its options object but does not pass it through to `deepseekChat()`.

9. **`complete()` default provider behavior:** In test mode, `complete()` defaults to `"openai"` regardless of what `getConfig().llm.defaultProvider` would return. This test-mode detection is duplicated in `autoRegisterMockProvider()` and `createHighLevelLLM()`.

10. **Gemini retry behavior inconsistency:** Gemini's catch block continues retrying on *all* non-401 errors when `attempt < maxRetries`, even non-transient errors. Other providers only retry errors that pass the `isRetryableError()` check.
