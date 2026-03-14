// ── src/providers/types.ts ──
// Shared types, interfaces, and error classes for the providers subsystem.

/** A single message in a chat conversation. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Structured response format descriptor. */
export interface ResponseFormatObject {
  type?: string;
  json_schema?: unknown;
}

/** Common options accepted by all provider adapters. */
export interface ProviderOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: string | ResponseFormatObject;
  topP?: number;
  stop?: string | string[];
  maxRetries?: number;
}

/** Token usage at the adapter level (snake_case). */
export interface AdapterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Response returned by provider adapters. */
export interface AdapterResponse {
  content: Record<string, unknown> | string;
  text?: string;
  usage?: AdapterUsage;
  raw?: unknown;
}

/** Streaming chunk yielded by DeepSeek in streaming mode. */
export interface StreamingChunk {
  content: string;
}

/** Token usage at the gateway level (camelCase). */
export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Response returned by the chat() gateway. */
export interface ChatResponse {
  content: Record<string, unknown> | string;
  usage: NormalizedUsage;
  raw?: unknown;
}

/** Known provider name literals. */
export type ProviderName =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "zai"
  | "zhipu"
  | "claudecode"
  | "moonshot"
  | "alibaba"
  | "mock";

/** Options for the chat() gateway function. */
export interface ChatOptions extends ProviderOptions {
  provider: ProviderName;
  metadata?: Record<string, unknown>;
  frequencyPenalty?: number;
  presencePenalty?: number;
}
// NOTE: `stream` is intentionally absent from ChatOptions.
// Streaming is adapter-only (DeepSeekOptions.stream) and is never
// exposed through the chat() gateway or any HighLevelLLM method.

/** Anthropic-specific options (no extras beyond ProviderOptions). */
export type AnthropicOptions = ProviderOptions;

/** OpenAI-specific options. */
export interface OpenAIOptions extends ProviderOptions {
  max_tokens?: number;
  seed?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/** Gemini-specific options. */
export interface GeminiOptions extends ProviderOptions {
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/** DeepSeek-specific options. */
export interface DeepSeekOptions extends ProviderOptions {
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
}

/** Alibaba-specific options. */
export interface AlibabaOptions extends ProviderOptions {
  frequencyPenalty?: number;
  presencePenalty?: number;
  thinking?: "enabled" | "disabled";
}

/** Moonshot-specific options. */
export interface MoonshotOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  thinking?: "enabled" | "disabled";
  maxRetries?: number;
  responseFormat?: string | ResponseFormatObject;
}

/** Claude Code-specific options. */
export interface ClaudeCodeOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
  responseFormat?: string | ResponseFormatObject;
  maxRetries?: number;
}

/** Telemetry event: request start. */
export interface LLMRequestStartEvent {
  id: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

/** Telemetry event: request complete. */
export interface LLMRequestCompleteEvent extends LLMRequestStartEvent {
  duration: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

/** Telemetry event: request error. */
export interface LLMRequestErrorEvent extends LLMRequestStartEvent {
  duration: number;
  error: string;
}

/** Provider availability map. */
export interface ProviderAvailability {
  openai: boolean;
  deepseek: boolean;
  anthropic: boolean;
  gemini: boolean;
  zai: boolean;
  zhipu: boolean;
  claudecode: boolean;
  moonshot: boolean;
  alibaba: boolean;
  mock: boolean;
}

/** Extracted message parts from extractMessages(). */
export interface ExtractedMessages {
  systemMsg: string;
  userMsg: string;
  userMessages: ChatMessage[];
  assistantMessages: ChatMessage[];
}

/** Error with HTTP status metadata. */
export interface ProviderError extends Error {
  status: number;
  code: string;
  details: unknown;
}

/** Error for invalid chat request message payloads. */
export class ProviderMessagesError extends Error {
  provider: string;

  constructor(provider: string, message?: string) {
    super(
      message ??
        `Provider "${provider}" requires at least one chat message`,
    );
    this.name = "ProviderMessagesError";
    this.provider = provider;
  }
}

/** A callable model function returned by factory APIs. */
export type ModelFunction = (
  options?: Partial<ChatOptions>,
) => Promise<ChatResponse>;

/** A provider group: an object whose properties are callable model functions. */
export type ProviderGroup = Record<string, ModelFunction>;

/** The nested provider->model map returned by createLLM(). */
export type ProviderModelMap = Record<string, ProviderGroup>;

/** Mock provider interface with concrete adapter contract. */
export interface MockProvider {
  chat(options: ChatOptions): Promise<AdapterResponse>;
}

/** Options for withRetry(). */
export interface RetryOptions {
  maxRetries?: number;
  backoffMs?: number;
}

/** Conversation chain returned by createChain(). */
export interface ConversationChain {
  addSystemMessage(content: string): void;
  addUserMessage(content: string): void;
  addAssistantMessage(content: string): void;
  getMessages(): ChatMessage[];
  clear(): void;
  execute(options: Omit<ChatOptions, "messages">): Promise<ChatResponse>;
}

/** High-level LLM API object. */
export interface HighLevelLLM {
  chat(options: ChatOptions): Promise<ChatResponse>;
  complete(
    prompt: string,
    options?: Partial<ChatOptions>,
  ): Promise<ChatResponse>;
  createChain(): ConversationChain;
  withRetry<T>(
    fn: () => Promise<T>,
    args?: unknown[],
    options?: RetryOptions,
  ): Promise<T>;
  parallel<T, R>(
    workerFn: (item: T) => Promise<R>,
    items: T[],
    concurrency?: number,
  ): Promise<R[]>;
  getAvailableProviders(): ProviderAvailability;
  /** Provider-grouped callable model functions (e.g., llm.openai.gpt5(opts)). */
  [provider: string]: ProviderGroup | ModelFunction | unknown;
}

/** Error for invalid/missing JSON response format. */
export class ProviderJsonModeError extends Error {
  provider: string;

  constructor(provider: string, message?: string) {
    super(
      message ??
        `Provider "${provider}" requires a valid JSON response format but none was provided`,
    );
    this.name = "ProviderJsonModeError";
    this.provider = provider;
  }
}

/** Error for failed JSON parsing of LLM response. */
export class ProviderJsonParseError extends Error {
  provider: string;
  model: string;
  sample: string;

  constructor(
    provider: string,
    model: string,
    sample: string,
    message?: string,
  ) {
    super(
      message ??
        `Provider "${provider}" model "${model}" returned unparseable JSON: ${sample.slice(0, 200)}`,
    );
    this.name = "ProviderJsonParseError";
    this.provider = provider;
    this.model = model;
    this.sample = sample;
  }
}
