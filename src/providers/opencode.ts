// ── src/providers/opencode.ts ──
// OpenCode provider adapter: pure helpers, SDK/CLI execution, availability checks.

import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
} from "./base.ts";
import { ProviderJsonParseError } from "./types.ts";
import type {
  AdapterResponse,
  AdapterUsage,
  ChatMessage,
  OpenCodeOptions,
  OpenCodePermissionAction,
  OpenCodePermissionConfig,
  OpenCodePermissionRule,
  ResponseFormatObject,
} from "./types.ts";

export type ParsedOpenCodeModel =
  | { providerID: string; modelID: string }
  | null;

export function parseOpenCodeModel(
  model: string | undefined,
): ParsedOpenCodeModel {
  if (model === undefined || model === "" || model === "default") {
    return null;
  }

  const parts = model.split("/");

  if (parts.length !== 2) {
    throw new Error(
      `Invalid OpenCode model "${model}": expected "provider/model" format`,
    );
  }

  const [providerID, modelID] = parts;

  if (!providerID) {
    throw new Error(
      `Invalid OpenCode model "${model}": provider part is empty`,
    );
  }

  if (!modelID) {
    throw new Error(
      `Invalid OpenCode model "${model}": model part is empty`,
    );
  }

  return { providerID, modelID };
}

export function buildOpenCodePromptText(messages: ChatMessage[]): string {
  return messages
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n\n");
}

export function isJsonMode(
  responseFormat: string | ResponseFormatObject | undefined,
): boolean {
  if (responseFormat === undefined) return false;

  if (typeof responseFormat === "string") {
    return responseFormat === "json" || responseFormat === "json_object";
  }

  return (
    responseFormat.type === "json_object" ||
    responseFormat.json_schema != null
  );
}

export function jsonSchemaFromResponseFormat(
  responseFormat: string | ResponseFormatObject | undefined,
): unknown | undefined {
  if (
    responseFormat !== undefined &&
    typeof responseFormat === "object" &&
    responseFormat.json_schema != null
  ) {
    return responseFormat.json_schema;
  }

  return undefined;
}

export function defaultOpenCodePermission(): OpenCodePermissionConfig {
  return { "*": "deny" };
}

function assertOpenCodePermissionAction(
  action: unknown,
  permission: string,
): asserts action is OpenCodePermissionAction {
  if (action === "allow" || action === "ask" || action === "deny") {
    return;
  }

  throw new Error(
    `Invalid OpenCode permission action for "${permission}": expected allow, ask, or deny`,
  );
}

export function normalizeOpenCodePermission(
  permission: OpenCodePermissionConfig,
): OpenCodePermissionRule[] {
  if (typeof permission === "string") {
    assertOpenCodePermissionAction(permission, "*");
    return [
      {
        permission: "*",
        pattern: "*",
        action: permission as OpenCodePermissionAction,
      },
    ];
  }

  if (Array.isArray(permission)) {
    return permission;
  }

  const rules: OpenCodePermissionRule[] = [];

  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      assertOpenCodePermissionAction(value, key);
      rules.push({
        permission: key,
        pattern: "*",
        action: value as OpenCodePermissionAction,
      });
    } else if (typeof value === "object" && value !== null) {
      for (const [pattern, action] of Object.entries(value)) {
        assertOpenCodePermissionAction(action, `${key}:${pattern}`);
        rules.push({
          permission: key,
          pattern,
          action: action as OpenCodePermissionAction,
        });
      }
    } else {
      throw new Error(
        `Invalid OpenCode permission config for "${key}": expected action or pattern map`,
      );
    }
  }

  return rules;
}

export function extractOpenCodeStructuredOutput(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw == null || typeof raw !== "object") return undefined;

  const response = raw as Record<string, unknown>;
  const info = response.info as Record<string, unknown> | undefined;

  if (info != null && typeof info === "object" && info.structured != null) {
    return info.structured as Record<string, unknown>;
  }

  return undefined;
}

export function extractOpenCodeText(raw: unknown): string {
  if (raw == null || typeof raw !== "object") return "";

  const response = raw as Record<string, unknown>;
  const parts: string[] = [];

  // SDK shape: content array with text parts
  const content = response.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (
        part != null &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        parts.push((part as Record<string, unknown>).text as string);
      }
    }
  }

  // SDK prompt response shape: parts array with text parts
  const responseParts = response.parts;
  if (Array.isArray(responseParts)) {
    for (const part of responseParts) {
      if (
        part != null &&
        typeof part === "object" &&
        (part as Record<string, unknown>).type === "text" &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        parts.push((part as Record<string, unknown>).text as string);
      }
    }
  }

  // CLI shape: events array with text events
  const events = response.events;
  if (Array.isArray(events)) {
    for (const event of events) {
      if (
        event != null &&
        typeof event === "object" &&
        (event as Record<string, unknown>).type === "text"
      ) {
        const evt = event as Record<string, unknown>;
        const part = evt.part as Record<string, unknown> | undefined;
        if (part != null && typeof part.text === "string") {
          parts.push(part.text);
        }
      }
    }
  }

  return parts.join("");
}

export function normalizeOpenCodeUsage(
  raw: unknown,
): AdapterUsage | undefined {
  if (raw == null || typeof raw !== "object") return undefined;

  const info = (raw as Record<string, unknown>).info;
  if (info == null || typeof info !== "object") return undefined;

  const tokens = (info as Record<string, unknown>).tokens;
  if (tokens == null || typeof tokens !== "object") return undefined;

  const input = (tokens as Record<string, unknown>).input;
  const output = (tokens as Record<string, unknown>).output;
  if (typeof input !== "number" || typeof output !== "number") return undefined;

  const total = (tokens as Record<string, unknown>).total;
  const totalTokens = typeof total === "number" ? total : input + output;

  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: totalTokens,
  };
}

function resolveOpenCodeBaseUrl(
  opencode: OpenCodeOptions["opencode"],
): string | undefined {
  return (
    opencode?.baseUrl ||
    process.env.PO_OPENCODE_BASE_URL ||
    process.env.OPENCODE_BASE_URL ||
    undefined
  );
}

function extractOpenCodeContent(
  raw: unknown,
  responseFormat: string | ResponseFormatObject | undefined,
  model: string,
): Record<string, unknown> | string {
  const structured = extractOpenCodeStructuredOutput(raw);
  if (structured != null) return structured;

  const text = extractOpenCodeText(raw);
  const jsonMode = isJsonMode(responseFormat);

  if (jsonMode) {
    const cleaned = stripMarkdownFences(text);
    const parsed = tryParseJSON(cleaned);

    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }

    throw new ProviderJsonParseError(
      "opencode",
      model || "default",
      cleaned.slice(0, 200),
    );
  }

  return stripMarkdownFences(text);
}

async function runOpenCodeCli(
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ text: string; events: unknown[] }> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timer);

    const events: unknown[] = [];
    const textParts: string[] = [];

    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let event: unknown;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }

      events.push(event);

      if (
        event != null &&
        typeof event === "object" &&
        (event as Record<string, unknown>).type === "text"
      ) {
        const evt = event as Record<string, unknown>;
        const part = evt.part as Record<string, unknown> | undefined;
        if (part != null && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      if (timedOut) {
        const timeoutError = new Error(
          `OpenCode CLI timed out after ${timeoutMs}ms with exit code ${proc.exitCode}: ${stderr || textParts.join("")}`,
        );
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      throw new Error(
        `OpenCode CLI exited with code ${proc.exitCode}: ${stderr || textParts.join("")}`,
      );
    }

    return { text: textParts.join(""), events };
  } catch (err) {
    clearTimeout(timer);
    proc.kill();
    throw err;
  }
}

export async function opencodeChat(
  options: OpenCodeOptions,
): Promise<AdapterResponse> {
  const {
    messages,
    model,
    maxRetries = 3,
    responseFormat,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = options;

  const opencode = options.opencode ?? {};
  const promptText = buildOpenCodePromptText(messages);
  const parsedModel = parseOpenCodeModel(model);
  const schema = jsonSchemaFromResponseFormat(responseFormat);
  const baseUrl = resolveOpenCodeBaseUrl(opencode);
  const mode = opencode.mode ?? (baseUrl != null ? "sdk" : "cli");
  const modelString = model || "default";

  let lastError: unknown;
  let sdkSessionID = opencode.sessionId;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (mode === "sdk") {
        if (baseUrl == null) {
          throw new Error(
            "OpenCode SDK mode requires a base URL: set opencode.baseUrl, PO_OPENCODE_BASE_URL, or OPENCODE_BASE_URL",
          );
        }

        const client: OpencodeClient = createOpencodeClient({ baseUrl });

        let sessionID: string;

        if (sdkSessionID) {
          sessionID = sdkSessionID;
        } else {
          const permission = normalizeOpenCodePermission(
            opencode.permission ?? defaultOpenCodePermission(),
          );

          const createParams: Record<string, unknown> = {
            directory: opencode.directory,
            permission,
          };

          if (parsedModel != null) {
            createParams.model = {
              id: parsedModel.modelID,
              providerID: parsedModel.providerID,
            };
          }

          if (opencode.agent != null) {
            createParams.agent = opencode.agent;
          }

          const createResult = await client.session.create(
            createParams as Parameters<typeof client.session.create>[0],
          );

          if (createResult.error) {
            throw new Error(
              `OpenCode session creation failed: ${JSON.stringify(createResult.error)}`,
            );
          }

          sdkSessionID = createResult.data.id;
          sessionID = sdkSessionID;
        }

        const promptParams: Record<string, unknown> = {
          sessionID,
          parts: [{ type: "text", text: promptText }],
          directory: opencode.directory,
        };

        if (parsedModel != null) {
          promptParams.model = {
            providerID: parsedModel.providerID,
            modelID: parsedModel.modelID,
          };
        }

        if (opencode.agent != null) {
          promptParams.agent = opencode.agent;
        }

        if (schema != null) {
          const format: Record<string, unknown> = {
            type: "json_schema",
            schema,
          };
          if (opencode.structuredOutputRetryCount != null) {
            format.retryCount = opencode.structuredOutputRetryCount;
          }
          promptParams.format = format;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

        try {
          const promptOptions = {
            ...promptParams,
            signal: controller.signal,
          } as unknown as Parameters<typeof client.session.prompt>[0];
          const result = await client.session.prompt(promptOptions);

          clearTimeout(timer);

          if (result.error) {
            throw new Error(
              `OpenCode prompt failed: ${JSON.stringify(result.error)}`,
            );
          }

          const raw = result.data;
          const content = extractOpenCodeContent(raw, responseFormat, modelString);
          const text = extractOpenCodeText(raw);
          const usage = normalizeOpenCodeUsage(raw);

          return { content, text, usage, raw };
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      }

      const args = ["opencode", "run", "--format", "json"];

      if (parsedModel != null) {
        args.push("--model", `${parsedModel.providerID}/${parsedModel.modelID}`);
      }

      if (opencode.agent != null) {
        args.push("--agent", opencode.agent);
      }

      if (opencode.directory != null) {
        args.push("--dir", opencode.directory);
      }

      if (opencode.sessionId != null) {
        args.push("--session", opencode.sessionId);
      }

      const permission = normalizeOpenCodePermission(
        opencode.permission ?? defaultOpenCodePermission(),
      );

      const env: Record<string, string> = {
        OPENCODE_PERMISSION: JSON.stringify(permission),
      };

      const cliResult = await runOpenCodeCli(args, env, requestTimeoutMs);
      const raw = { events: cliResult.events };
      const content = extractOpenCodeContent(raw, responseFormat, modelString);
      const text = extractOpenCodeText(raw);

      return { content, text, raw };
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw lastError;
}

export function isOpenCodeAvailable(): boolean {
  if (process.env.PO_OPENCODE_BASE_URL || process.env.OPENCODE_BASE_URL) {
    return true;
  }

  try {
    const result = Bun.spawnSync(["opencode", "--version"], {
      timeout: 5000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
