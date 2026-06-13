// ── src/providers/opencode.ts ──
// Pure helper functions for the OpenCode provider adapter.

import type {
  AdapterUsage,
  ChatMessage,
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

export function normalizeOpenCodePermission(
  permission: OpenCodePermissionConfig,
): OpenCodePermissionRule[] {
  if (typeof permission === "string") {
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
      rules.push({
        permission: key,
        pattern: "*",
        action: value as OpenCodePermissionAction,
      });
    } else if (typeof value === "object" && value !== null) {
      for (const [pattern, action] of Object.entries(value)) {
        rules.push({
          permission: key,
          pattern,
          action: action as OpenCodePermissionAction,
        });
      }
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

  const response = raw as Record<string, unknown>;
  const info = response.info as Record<string, unknown> | undefined;

  if (info == null || typeof info !== "object") return undefined;

  const promptTokens = info.prompt_tokens ?? info.input_tokens;
  const completionTokens = info.completion_tokens ?? info.output_tokens;

  if (
    typeof promptTokens !== "number" ||
    typeof completionTokens !== "number"
  ) {
    return undefined;
  }

  const totalTokens =
    typeof info.total_tokens === "number"
      ? info.total_tokens
      : promptTokens + completionTokens;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}
