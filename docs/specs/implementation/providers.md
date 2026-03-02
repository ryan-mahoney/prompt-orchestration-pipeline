# Implementation Specification: `providers`

**Analysis source:** `docs/specs/analysis/providers.md`

---

## 1. Qualifications

- TypeScript strict mode (discriminated unions, generics, `Partial<>`, index signatures, mapped types)
- HTTP client programming with the `fetch` Web API (request construction, header management, response parsing, error classification)
- Server-Sent Events (SSE) parsing for streaming responses (DeepSeek)
- Bun subprocess APIs (`Bun.spawn`, `Bun.spawnSync`) for Claude Code CLI invocation
- Exponential backoff retry logic
- EventEmitter / event bus patterns for telemetry
- JavaScript `Proxy` API for the LLM override mechanism
- OpenAI SDK (`openai` npm package) — Responses API and Chat Completions API
- Async generators for streaming mode
- JSON parsing with progressive fallback strategies
- LLM provider API protocols: Anthropic Messages API, OpenAI Responses/Chat Completions, Google Gemini GenerateContent, DeepSeek/Moonshot/Zhipu OpenAI-compatible APIs

---

## 2. Problem Statement

The system requires a unified interface for sending chat-completion requests to seven different LLM providers (Anthropic, OpenAI, Gemini, DeepSeek, Moonshot, Zhipu, Claude Code) and consuming their responses in a normalized format. The existing JS implementation provides this via per-provider adapter functions behind a central `chat()` dispatcher with telemetry, cost calculation, and named-model registry factories. This spec defines the TypeScript replacement.

---

## 3. Goal

A set of TypeScript modules under `src/providers/` and `src/llm/` that provide identical behavioral contracts to the analyzed JS modules — per-provider adapters, shared utilities, a central dispatcher with telemetry, named-model factories, and a Proxy-based override mechanism — runs on Bun, and passes all acceptance criteria below.

---

## 4. Architecture

### Files to create

| File | Responsibility |
|------|---------------|
| `src/providers/types.ts` | Shared types, interfaces, and error classes for the providers subsystem. |
| `src/providers/base.ts` | Message extraction, retry classification, JSON parsing with fallback, markdown fence stripping, response-format validation, error construction, sleep utility. |
| `src/providers/anthropic.ts` | Anthropic Messages API adapter. |
| `src/providers/openai.ts` | OpenAI adapter with Responses API / Chat Completions API routing and fallback. |
| `src/providers/gemini.ts` | Google Gemini GenerateContent adapter. |
| `src/providers/deepseek.ts` | DeepSeek adapter with streaming support via async generator. |
| `src/providers/moonshot.ts` | Moonshot adapter with content-filter fallback to DeepSeek. |
| `src/providers/zhipu.ts` | Zhipu (Z.ai) OpenAI-compatible adapter. |
| `src/providers/claude-code.ts` | Claude Code CLI adapter using Bun subprocess APIs. |
| `src/llm/index.ts` | Central gateway: `chat()` dispatcher, `complete()`, named-model factories (`createLLM`, `createNamedModelsAPI`, `createHighLevelLLM`), `createLLMWithOverride`, `createChain`, `withRetry`, `parallel`, telemetry event bus, mock provider, cost calculation. |

### Key types and interfaces

```typescript
// ── src/providers/types.ts ──

/** A single message in a chat conversation. */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Common options accepted by all provider adapters. */
interface ProviderOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: string | ResponseFormatObject;
  topP?: number;
  stop?: string | string[];
  maxRetries?: number;
}

/** Structured response format descriptor. */
interface ResponseFormatObject {
  type?: string;
  json_schema?: unknown;
}

/** Token usage at the adapter level (snake_case). */
interface AdapterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Response returned by provider adapters. */
interface AdapterResponse {
  content: Record<string, unknown> | string;
  text?: string;
  usage?: AdapterUsage;
  raw?: unknown;
}

/** Streaming chunk yielded by DeepSeek in streaming mode. */
interface StreamingChunk {
  content: string;
}

/** Token usage at the gateway level (camelCase). */
interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Response returned by the chat() gateway. */
interface ChatResponse {
  content: Record<string, unknown> | string;
  usage: NormalizedUsage;
  raw?: unknown;
}

/** Options for the chat() gateway function. */
interface ChatOptions extends ProviderOptions {
  provider: ProviderName;
  metadata?: Record<string, unknown>;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
}

/** Anthropic-specific options (no extras beyond ProviderOptions). */
type AnthropicOptions = ProviderOptions;

/** OpenAI-specific options. */
interface OpenAIOptions extends ProviderOptions {
  max_tokens?: number;
  seed?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/** Gemini-specific options. */
interface GeminiOptions extends ProviderOptions {
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/** DeepSeek-specific options. */
interface DeepSeekOptions extends ProviderOptions {
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
}

/** Moonshot-specific options. */
interface MoonshotOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  thinking?: "enabled" | "disabled";
  maxRetries?: number;
  responseFormat?: string | ResponseFormatObject;
}

/** Claude Code-specific options. */
interface ClaudeCodeOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
  responseFormat?: string | ResponseFormatObject;
  maxRetries?: number;
}

/** Known provider name literals. */
type ProviderName =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "zhipu"
  | "claudecode"
  | "moonshot"
  | "mock";

/** Telemetry event: request start. */
interface LLMRequestStartEvent {
  id: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

/** Telemetry event: request complete. */
interface LLMRequestCompleteEvent extends LLMRequestStartEvent {
  duration: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

/** Telemetry event: request error. */
interface LLMRequestErrorEvent extends LLMRequestStartEvent {
  duration: number;
  error: string;
}

/** Provider availability map. */
interface ProviderAvailability {
  openai: boolean;
  deepseek: boolean;
  anthropic: boolean;
  gemini: boolean;
  zhipu: boolean;
  claudecode: boolean;
  moonshot: boolean;
  mock: boolean;
}

/** Extracted message parts from extractMessages(). */
interface ExtractedMessages {
  systemMsg: string;
  userMsg: string;
  userMessages: ChatMessage[];
  assistantMessages: ChatMessage[];
}

/** Error with HTTP status metadata. */
interface ProviderError extends Error {
  status: number;
  code: string;
  details: unknown;
}

/** Error for invalid/missing JSON response format. */
class ProviderJsonModeError extends Error {
  provider: string;
}

/** Error for failed JSON parsing of LLM response. */
class ProviderJsonParseError extends Error {
  provider: string;
  model: string;
  sample: string;
}

/** Conversation chain returned by createChain(). */
interface ConversationChain {
  addSystemMessage(content: string): void;
  addUserMessage(content: string): void;
  addAssistantMessage(content: string): void;
  getMessages(): ChatMessage[];
  clear(): void;
  execute(options: Omit<ChatOptions, "messages">): Promise<ChatResponse>;
}

/** High-level LLM API object. */
interface HighLevelLLM {
  chat(options: ChatOptions): Promise<ChatResponse>;
  complete(prompt: string, options?: Partial<ChatOptions>): Promise<ChatResponse>;
  createChain(): ConversationChain;
  withRetry<T>(fn: () => Promise<T>, args?: unknown[], options?: RetryOptions): Promise<T>;
  parallel<T, R>(workerFn: (item: T) => Promise<R>, items: T[], concurrency?: number): Promise<R[]>;
  getAvailableProviders(): ProviderAvailability;
  [provider: string]: unknown;
}

/** Options for withRetry(). */
interface RetryOptions {
  maxRetries?: number;
  backoffMs?: number;
}
```

### Bun-specific design decisions

| Area | Change from JS Original | Rationale |
|------|------------------------|-----------|
| Claude Code subprocess | Replace `node:child_process` `spawn`/`spawnSync` with `Bun.spawn`/`Bun.spawnSync` | Native Bun subprocess API — simpler, no Node.js compat layer needed. |
| Debug file write | Replace `fs.writeFileSync` with `Bun.write` (or remove entirely — see Notes) | Bun-native file I/O. |
| EventEmitter | Keep `node:events` `EventEmitter` (Bun supports it natively) | Bun has full Node.js `events` compatibility; no migration needed. |
| `fetch` usage | All providers already use global `fetch` (except OpenAI SDK) — no change needed | Web-standard API, natively supported by Bun. |

### Dependency map

**Internal `src/` imports:**

| This module imports from | What |
|--------------------------|------|
| `src/core/logger.ts` | `createLogger` |
| `src/core/config.ts` | `getConfig` |
| `src/config/models.ts` | `MODEL_CONFIG`, `DEFAULT_MODEL_BY_PROVIDER`, `aliasToFunctionName`, `PROVIDER_FUNCTIONS`, `FUNCTION_NAME_BY_ALIAS`, `getModelConfig` |
| `src/providers/base.ts` | (used by all adapters) `extractMessages`, `isRetryableError`, `sleep`, `stripMarkdownFences`, `tryParseJSON`, `createProviderError`, `ensureJsonResponseFormat`, `ProviderJsonModeError`, `ProviderJsonParseError` |
| `src/providers/deepseek.ts` | (used by `moonshot.ts`) `deepseekChat` |

**External packages:**

| Package | Used by | Purpose |
|---------|---------|---------|
| `openai` | `src/providers/openai.ts` | OpenAI SDK client for Responses and Chat Completions APIs |
| `node:events` | `src/llm/index.ts` | `EventEmitter` for telemetry event bus |

---

## 5. Acceptance Criteria

### Core behavior

1. `chat()` routes to the correct provider adapter based on the `provider` field and returns a `ChatResponse` with `content` and normalized `usage` (camelCase).
2. Each provider adapter transforms the common `ProviderOptions` into the provider-specific HTTP request format and normalizes the response into `AdapterResponse`.
3. `extractMessages()` correctly splits a messages array into `systemMsg`, `userMsg`, `userMessages`, and `assistantMessages`.
4. `tryParseJSON()` successfully parses valid JSON, JSON wrapped in markdown fences, and JSON embedded in surrounding text (first `{...}` or `[...]` substring extraction).
5. `stripMarkdownFences()` removes markdown code fences from text.
6. `ensureJsonResponseFormat()` accepts valid JSON formats (`"json"`, `"json_object"`, `{ type: "json_object" }`, `{ json_schema: ... }`) and throws `ProviderJsonModeError` for invalid/missing formats.
7. `createLLM()` returns a nested object of provider-grouped callable functions built from `MODEL_CONFIG` / `PROVIDER_FUNCTIONS`.
8. `createHighLevelLLM()` returns an object combining `chat`, `complete`, `createChain`, `withRetry`, `parallel`, `getAvailableProviders` with provider-grouped functions.
9. `createLLMWithOverride()` returns a Proxy that redirects all method calls to a single override provider/model, while skipping interception for `toJSON`, `toString`, `valueOf`, `then`, `catch`, `finally`, and `constructor`.
10. `complete()` sends a single user message via `chat()` using the configured default provider.

### Provider-specific behavior

11. **Anthropic:** Uses `https://api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01` header, transforms messages into Anthropic's `system` + `messages` format, normalizes usage from `input_tokens`/`output_tokens`.
12. **OpenAI:** Routes to Responses API for models matching `/^gpt-5/i`, falls back to Chat Completions API on "unsupported" errors, and uses Chat Completions API for all other models.
13. **OpenAI:** Destructures `max_tokens` to prevent it from leaking through `...rest` into the request body.
14. **Gemini:** Constructs `contents`/`systemInstruction`/`generationConfig` format, sets all four safety categories to `BLOCK_NONE`, supports `json_schema` via system instruction injection.
15. **DeepSeek:** Supports streaming mode via async generator yielding `StreamingChunk` objects; suppresses `response_format` when `stream` is true.
16. **Moonshot:** Falls back to DeepSeek on content-filter errors (HTTP 400 with "high risk"/"rejected"), using `deepseek-reasoner` if thinking was enabled and `deepseek-chat` otherwise, but only if `DEEPSEEK_API_KEY` is set.
17. **Zhipu:** Uses OpenAI-compatible chat completions format against the Zhipu API endpoint, supports JSON schema via system instruction injection.
18. **Claude Code:** Invokes `claude` CLI via `Bun.spawn` with `--output-format json`, parses the JSON envelope, reports usage as zeros.
19. **Claude Code:** `isClaudeCodeAvailable()` uses `Bun.spawnSync` with a 5-second timeout to check `claude --version`.

### Retry and error handling

20. All adapters retry transient errors (network errors, HTTP 429/500/502/503/504) with exponential backoff (`2^attempt * 1000ms`) up to `maxRetries` (default 3).
21. HTTP 401 / authentication errors are never retried by any adapter.
22. `ProviderJsonParseError` is not retried by adapters (Moonshot explicitly does not retry it).
23. `isRetryableError()` correctly classifies transient vs non-transient errors.
24. `withRetry()` in the gateway supports configurable `maxRetries` and `backoffMs` with exponential backoff, and skips retry on 401 errors.

### Telemetry

25. `chat()` emits `llm:request:start` before the provider call and `llm:request:complete` or `llm:request:error` after.
26. Telemetry events include `id`, `provider`, `model`, `metadata`, `timestamp`, and (on complete) `duration`, `promptTokens`, `completionTokens`, `totalTokens`, `cost`.
27. `getLLMEvents()` returns the global `EventEmitter` instance.

### Cost and usage

28. `calculateCost()` computes dollar cost from token usage and model pricing in `MODEL_CONFIG`.
29. `estimateTokens()` returns `Math.ceil(text.length / 4)`.
30. Usage is always present in `ChatResponse` — estimated if the API does not provide it.

### Concurrency

31. `parallel()` executes an async worker over items with bounded concurrency (default 5) and preserves result ordering.

### Conversation chain

32. `createChain()` returns a stateful chain with `addSystemMessage`, `addUserMessage`, `addAssistantMessage`, `getMessages`, `clear`, and `execute` methods.

### JSON format inference

33. For OpenAI, DeepSeek, Gemini, and Moonshot, when `responseFormat` is undefined/null/empty, the gateway checks the first two messages for the word "json" (case-insensitive) and infers `"json_object"` format if found.

### Provider availability

34. `getAvailableProviders()` returns a map of provider names to booleans based on environment variables (or `isClaudeCodeAvailable()` for claudecode, or mock provider registration for mock).

### Mock provider

35. `registerMockProvider()` registers a mock provider for testing. In test mode (`NODE_ENV=test` or `VITEST=true`), a mock provider is auto-registered if the default provider is `"mock"` and none has been registered.

---

## 6. Notes

### Design trade-offs

- **OpenAI SDK vs raw `fetch`:** The analysis shows `openai.js` uses the `openai` npm package (SDK client). Keeping the SDK for the TypeScript migration preserves API compatibility and simplifies the Responses API / Chat Completions API routing logic. Replacing it with raw `fetch` would reduce dependencies but increase maintenance surface. Decision: **keep the SDK**.
- **Debug file write:** The unconditional `writeFileSync("/tmp/messages.log")` in `chat()` is flagged as a development artifact in the analysis. The TS implementation should gate this behind an environment variable (e.g., `LLM_DEBUG=1`) or remove it entirely. Decision: **gate behind `LLM_DEBUG` env var** — if set, write to `/tmp/messages.log` using `Bun.write`.
- **Inconsistent `text` field:** DeepSeek and Moonshot adapters do not include a `text` field. The TS implementation should normalize this: all adapters include `text` as an optional field in `AdapterResponse`. Callers should not rely on `text` — use `content` as the canonical field.
- **`parallel()` concurrency bug:** The analysis identifies a subtle bug where `Promise.race` + `findIndex` may not correctly remove the resolved promise. The TS implementation should fix this by tracking promises via a `Set` or using the promise identity correctly.

### Open questions from analysis

- **Gemini `frequencyPenalty`/`presencePenalty` params:** These are destructured but unused in the JS original. The TS implementation will destructure and discard them (same behavior) with a comment noting Gemini does not support these parameters.
- **Anthropic API version header:** Hardcoded to `"2023-06-01"`. The TS implementation will keep this hardcoded with a comment. Updating it requires a code change.
- **Token estimation accuracy:** `estimateTokens` uses a 4-char-per-token approximation. This is acceptable for cost estimates when the API does not return usage data. No change needed.

### Migration-specific concerns

- **Behaviors that change intentionally:**
  - Debug file write gated behind `LLM_DEBUG` instead of unconditional.
  - `parallel()` concurrency bug fixed.
- **Behaviors that must remain identical:**
  - All retry logic, error classification, and backoff timing.
  - Provider-specific request construction and response normalization.
  - Telemetry event shapes and emission timing.
  - Named-model factory construction from `MODEL_CONFIG`.
  - Proxy-based override mechanism and built-in method guard.
  - JSON format inference behavior.
  - Mock provider auto-registration in test mode.

### Dependencies on other modules

- **`src/config/models.ts`** (config module) must be migrated first — it provides `MODEL_CONFIG`, `DEFAULT_MODEL_BY_PROVIDER`, `aliasToFunctionName`, `PROVIDER_FUNCTIONS`, `FUNCTION_NAME_BY_ALIAS`, and `getModelConfig`.
- **`src/core/logger.ts`** must be available — adapters and the gateway use `createLogger` for diagnostic logging.
- **`src/core/config.ts`** must be available — the gateway uses `getConfig()` to determine `defaultProvider`.
- If these modules are not yet migrated, stub them with type-compatible shims.

### Performance considerations

- `Bun.spawn` for Claude Code invocation is expected to be faster than Node.js `child_process.spawn`.
- `Bun.write` for the debug log is async and non-blocking (vs `writeFileSync` in the original).
- All `fetch` calls are already using the Web-standard API, which Bun optimizes natively.

---

## 7. Implementation Steps

### Step 1: Create shared types

**What to do:** Create `src/providers/types.ts` with all interfaces, type aliases, and error classes defined in Section 4 (Architecture → Key types and interfaces).

**Why:** All subsequent modules import from this file. Types and interfaces must exist first (ordering principle: types → pure functions → stateful modules).

**Type signatures:**

```typescript
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ProviderOptions { messages: ChatMessage[]; model?: string; temperature?: number; maxTokens?: number; responseFormat?: string | ResponseFormatObject; topP?: number; stop?: string | string[]; maxRetries?: number }
export interface AdapterResponse { content: Record<string, unknown> | string; text?: string; usage?: AdapterUsage; raw?: unknown }
export interface ChatResponse { content: Record<string, unknown> | string; usage: NormalizedUsage; raw?: unknown }
export type ProviderName = "openai" | "anthropic" | "deepseek" | "gemini" | "zhipu" | "claudecode" | "moonshot" | "mock"
export class ProviderJsonModeError extends Error { provider: string; constructor(provider: string, message?: string) }
export class ProviderJsonParseError extends Error { provider: string; model: string; sample: string; constructor(provider: string, model: string, sample: string, message?: string) }
```

**Test:** `src/providers/__tests__/types.test.ts` — Verify `ProviderJsonModeError` and `ProviderJsonParseError` can be instantiated with correct properties and are instances of `Error`. Verify `ProviderJsonModeError.provider` is set. Verify `ProviderJsonParseError.provider`, `.model`, and `.sample` are set.

---

### Step 2: Implement shared base utilities

**What to do:** Create `src/providers/base.ts` exporting `extractMessages`, `isRetryableError`, `sleep`, `stripMarkdownFences`, `tryParseJSON`, `createProviderError`, and `ensureJsonResponseFormat`.

**Why:** Every adapter depends on these utilities. They are pure functions with no I/O (except `sleep`).

**Type signatures:**

```typescript
export function extractMessages(messages: ChatMessage[]): ExtractedMessages
export function isRetryableError(err: unknown): boolean
export function sleep(ms: number): Promise<void>
export function stripMarkdownFences(text: string): string
export function tryParseJSON(text: string): unknown
export function createProviderError(status: number, errorBody: unknown, fallbackMessage: string): ProviderError
export function ensureJsonResponseFormat(responseFormat: unknown, providerName: string): void
```

**Test:** `src/providers/__tests__/base.test.ts`
- `extractMessages`: splits system/user/assistant messages correctly; handles empty array; handles multiple user messages joined into `userMsg`.
- `isRetryableError`: returns `true` for 429, 500, 502, 503, 504, network errors (`ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNREFUSED`); returns `false` for 401, 400, `ProviderJsonParseError`.
- `stripMarkdownFences`: removes `` ```json ... ``` `` and `` ```lang ... ``` `` fences; preserves text without fences.
- `tryParseJSON`: parses valid JSON; parses fenced JSON; extracts first `{...}` from surrounding text; returns original text on total failure.
- `ensureJsonResponseFormat`: accepts `"json"`, `"json_object"`, `{ type: "json_object" }`, `{ json_schema: {} }`; throws `ProviderJsonModeError` for `undefined`, `null`, `""`, `"text"`.
- `createProviderError`: returns `Error` with `.status`, `.code`, `.details`.

---

### Step 3: Implement Anthropic adapter

**What to do:** Create `src/providers/anthropic.ts` exporting `anthropicChat(options: AnthropicOptions): Promise<AdapterResponse>`.

**Why:** Anthropic is a core provider. This adapter makes HTTP requests to `https://api.anthropic.com/v1/messages` using `fetch`. Satisfies acceptance criteria 11, 20, 21.

**Type signatures:**

```typescript
export async function anthropicChat(options: AnthropicOptions): Promise<AdapterResponse>
```

**Implementation details:**
- Default model: `"claude-3-sonnet"`, temperature: `0.7`, maxTokens: `8192`, responseFormat: `"json"`.
- Call `ensureJsonResponseFormat` to validate format.
- Use `extractMessages` to split messages.
- Construct request with `anthropic-version: 2023-06-01` header, `x-api-key` from `ANTHROPIC_API_KEY`.
- Retry loop with `isRetryableError` + exponential backoff.
- Immediate throw on 401.
- Normalize usage from `input_tokens`/`output_tokens` to `prompt_tokens`/`completion_tokens`/`total_tokens`.
- Strip markdown fences, parse JSON via `tryParseJSON`.

**Test:** `src/providers/__tests__/anthropic.test.ts`
- Mock `fetch` to return a valid Anthropic response; verify `content` is parsed JSON, `usage` has correct shape, `text` is present.
- Mock `fetch` to return 401; verify immediate throw without retry.
- Mock `fetch` to return 429 then 200; verify retry occurs and succeeds.
- Verify `ProviderJsonModeError` is thrown when `responseFormat` is invalid.

---

### Step 4: Implement OpenAI adapter

**What to do:** Create `src/providers/openai.ts` exporting `openaiChat(options: OpenAIOptions): Promise<AdapterResponse>`.

**Why:** OpenAI has the most complex routing logic (Responses API vs Chat Completions API). Satisfies acceptance criteria 12, 13, 20, 21.

**Type signatures:**

```typescript
export async function openaiChat(options: OpenAIOptions): Promise<AdapterResponse>
```

**Implementation details:**
- Lazy-initialize OpenAI SDK client singleton.
- Route to Responses API for models matching `/^gpt-5/i`; Chat Completions API for others.
- Destructure and discard `max_tokens` to prevent `...rest` leakage.
- On "unsupported" error from Responses API, retry with Chat Completions API (within same attempt).
- Estimate usage at ~4 chars/token for Responses API path.
- Default model: `"gpt-5-chat-latest"`, responseFormat: `"json_object"`.

**Test:** `src/providers/__tests__/openai.test.ts`
- Mock OpenAI SDK; verify Responses API is used for `"gpt-5"` model.
- Mock "unsupported" error from Responses API; verify fallback to Chat Completions API.
- Verify `max_tokens` does not appear in the request body.
- Verify 401 is not retried.

---

### Step 5: Implement Gemini adapter

**What to do:** Create `src/providers/gemini.ts` exporting `geminiChat(options: GeminiOptions): Promise<AdapterResponse>`.

**Why:** Gemini uses a distinct request format with safety settings. Satisfies acceptance criterion 14.

**Type signatures:**

```typescript
export async function geminiChat(options: GeminiOptions): Promise<AdapterResponse>
```

**Implementation details:**
- Construct `contents`/`systemInstruction`/`generationConfig` format.
- Set all four safety categories to `BLOCK_NONE`.
- Support `json_schema` via system instruction injection.
- Destructure and discard `frequencyPenalty`/`presencePenalty`.
- Normalize usage from `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`).
- Default model: `"gemini-2.5-flash"`, temperature: `0.7`.
- Endpoint: `GEMINI_BASE_URL` env var or default `https://generativelanguage.googleapis.com/v1beta`.
- API key via `GEMINI_API_KEY` as query parameter.

**Test:** `src/providers/__tests__/gemini.test.ts`
- Mock `fetch`; verify request body has `safetySettings` with `BLOCK_NONE` for all four categories.
- Verify `contents`/`systemInstruction` format.
- Verify JSON schema is injected into system instruction when `responseFormat` has `json_schema`.
- Verify usage is normalized from Gemini's `usageMetadata` format.

---

### Step 6: Implement DeepSeek adapter

**What to do:** Create `src/providers/deepseek.ts` exporting `deepseekChat(options: DeepSeekOptions): Promise<AdapterResponse | AsyncGenerator<StreamingChunk>>`.

**Why:** DeepSeek is the only provider supporting streaming. Satisfies acceptance criterion 15.

**Type signatures:**

```typescript
export async function deepseekChat(options: DeepSeekOptions): Promise<AdapterResponse>
export async function deepseekChat(options: DeepSeekOptions & { stream: true }): Promise<AsyncGenerator<StreamingChunk>>
export async function deepseekChat(options: DeepSeekOptions): Promise<AdapterResponse | AsyncGenerator<StreamingChunk>>
```

**Implementation details:**
- Endpoint: `https://api.deepseek.com/chat/completions`.
- When `stream: true`, return async generator yielding `{ content: string }` chunks from SSE. Suppress `response_format` in streaming mode.
- Non-streaming: parse response, determine JSON mode locally (does not call `ensureJsonResponseFormat`).
- Default model: `"deepseek-chat"`, temperature: `0.7`, responseFormat: `"json_object"`.

**Test:** `src/providers/__tests__/deepseek.test.ts`
- Mock `fetch` for non-streaming; verify `content` is parsed JSON with `usage`.
- Mock `fetch` for streaming (return SSE body); verify async generator yields chunks.
- Verify `response_format` is omitted when `stream: true`.

---

### Step 7: Implement Moonshot adapter

**What to do:** Create `src/providers/moonshot.ts` exporting `moonshotChat(options: MoonshotOptions): Promise<AdapterResponse>`.

**Why:** Moonshot has content-filter fallback logic to DeepSeek. Satisfies acceptance criterion 16.

**Type signatures:**

```typescript
export async function moonshotChat(options: MoonshotOptions): Promise<AdapterResponse>
```

**Implementation details:**
- Endpoint: `https://api.moonshot.ai/v1/chat/completions`.
- Does not accept `temperature`, `topP`, `frequencyPenalty`, `presencePenalty`.
- Always uses `json_object` response format. Includes `thinking` parameter.
- On HTTP 400 with "high risk"/"rejected", fall back to `deepseekChat` if `DEEPSEEK_API_KEY` is set; use `deepseek-reasoner` if thinking enabled, `deepseek-chat` otherwise.
- Does not retry `ProviderJsonParseError`.
- Default model: `"kimi-k2.5"`, maxTokens: `32768`, thinking: `"enabled"`.

**Test:** `src/providers/__tests__/moonshot.test.ts`
- Mock `fetch` to return content-filter error (400 + "high risk"); verify fallback to DeepSeek.
- Verify `ProviderJsonParseError` is not retried.
- Verify `thinking` parameter is included in request body.

---

### Step 8: Implement Zhipu adapter

**What to do:** Create `src/providers/zhipu.ts` exporting `zhipuChat(options: ProviderOptions): Promise<AdapterResponse>`.

**Why:** Zhipu follows the OpenAI-compatible format. Satisfies acceptance criterion 17.

**Type signatures:**

```typescript
export async function zhipuChat(options: ProviderOptions): Promise<AdapterResponse>
```

**Implementation details:**
- Endpoint: `https://api.z.ai/api/paas/v4/chat/completions`.
- Structurally similar to Anthropic adapter; uses OpenAI-compatible chat completions format.
- Supports JSON schema via system instruction injection.
- Default model: `"glm-4-plus"`, temperature: `0.7`, maxTokens: `8192`, responseFormat: `"json"`.

**Test:** `src/providers/__tests__/zhipu.test.ts`
- Mock `fetch`; verify request format matches OpenAI-compatible chat completions.
- Verify JSON schema injection in system instruction.
- Verify usage normalization.

---

### Step 9: Implement Claude Code adapter

**What to do:** Create `src/providers/claude-code.ts` exporting `claudeCodeChat(options: ClaudeCodeOptions): Promise<AdapterResponse>` and `isClaudeCodeAvailable(): boolean`.

**Why:** Claude Code uses subprocess invocation instead of HTTP. Satisfies acceptance criteria 18, 19.

**Type signatures:**

```typescript
export async function claudeCodeChat(options: ClaudeCodeOptions): Promise<AdapterResponse>
export function isClaudeCodeAvailable(): boolean
```

**Implementation details:**
- Use `Bun.spawn` to invoke `claude` CLI with `--output-format json`, `--model <model>`, `--max-turns <maxTurns>`.
- Collect stdout, parse JSON envelope, extract inner text content, parse inner JSON.
- Usage always reported as zeros.
- `isClaudeCodeAvailable`: use `Bun.spawnSync` for `claude --version` with 5-second timeout.
- Default model: `"sonnet"`, maxTurns: `1`, responseFormat: `"json"`.

**Test:** `src/providers/__tests__/claude-code.test.ts`
- Mock `Bun.spawn`; verify CLI is invoked with `--output-format json`.
- Verify usage is `{ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }`.
- Mock `Bun.spawnSync` for `isClaudeCodeAvailable`; verify returns `true` on exit code 0, `false` otherwise.

---

### Step 10: Implement the LLM gateway

**What to do:** Create `src/llm/index.ts` exporting `chat`, `complete`, `createLLM`, `createNamedModelsAPI`, `createHighLevelLLM`, `createLLMWithOverride`, `createChain`, `withRetry`, `parallel`, `getLLMEvents`, `registerMockProvider`, `getAvailableProviders`, `estimateTokens`, `calculateCost`.

**Why:** This is the central dispatcher that wires providers together and provides the public API used by the rest of the system. Satisfies acceptance criteria 1, 7, 8, 9, 10, 25–35.

**Type signatures:**

```typescript
export async function chat(options: ChatOptions): Promise<ChatResponse>
export async function complete(prompt: string, options?: Partial<ChatOptions>): Promise<ChatResponse>
export function createLLM(): Record<string, Record<string, (options: Partial<ChatOptions>) => Promise<ChatResponse>>>
export function createNamedModelsAPI(): ReturnType<typeof createLLM>
export function createHighLevelLLM(options?: Partial<ChatOptions>): HighLevelLLM
export function createLLMWithOverride(override: { provider: ProviderName; model: string }): HighLevelLLM
export function createChain(): ConversationChain
export async function withRetry<T>(fn: () => Promise<T>, args?: unknown[], options?: RetryOptions): Promise<T>
export async function parallel<T, R>(workerFn: (item: T) => Promise<R>, items: T[], concurrency?: number): Promise<R[]>
export function getLLMEvents(): EventEmitter
export function registerMockProvider(provider: { chat: (options: ChatOptions) => Promise<AdapterResponse> }): void
export function getAvailableProviders(): ProviderAvailability
export function estimateTokens(text: string): number
export function calculateCost(provider: string, model: string, usage: NormalizedUsage): number
```

**Implementation details:**
- `chat()`: Check provider availability, emit `llm:request:start`, assemble provider-specific args, call adapter, normalize usage to camelCase, calculate cost, emit `llm:request:complete` or `llm:request:error`, return `ChatResponse`. Optionally write debug log gated by `LLM_DEBUG`.
- JSON format inference: For OpenAI, DeepSeek, Gemini, Moonshot — if `responseFormat` is falsy, check first two messages for "json" (case-insensitive) and infer `"json_object"`.
- `createLLM()` / `createNamedModelsAPI()`: Build nested provider-grouped callable functions from `PROVIDER_FUNCTIONS`.
- `createLLMWithOverride()`: Return a `Proxy` that intercepts property access and redirects all calls to override provider/model; guard built-in methods (`toJSON`, `toString`, `valueOf`, `then`, `catch`, `finally`, `constructor`).
- `parallel()`: Fix concurrency bug from JS original — use `Set` to track executing promises correctly.
- Mock provider auto-registration in test mode.

**Test:** `src/llm/__tests__/index.test.ts`
- Register a mock provider; call `chat({ provider: "mock", messages: [...] })`; verify response shape.
- Verify `llm:request:start` and `llm:request:complete` events are emitted with correct fields.
- Verify `estimateTokens("abcdefgh")` returns `2`.
- Verify `calculateCost` produces correct dollar amount from `MODEL_CONFIG` pricing.
- Verify `createChain` correctly accumulates messages and `execute` calls `chat`.
- Verify `parallel` executes with bounded concurrency and preserves result ordering.
- Verify `withRetry` retries on transient errors and skips retry on 401.
- Verify `createLLMWithOverride` redirects calls and guards built-in methods.
- Verify `getAvailableProviders` returns boolean map based on env vars.
- Verify JSON format inference from message content.
