import { spawn, spawnSync } from "child_process";
import {
  extractMessages,
  isRetryableError,
  sleep,
  stripMarkdownFences,
  tryParseJSON,
  ensureJsonResponseFormat,
  ProviderJsonParseError,
} from "./base.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("ClaudeCode");

/**
 * Check if Claude Code CLI is available
 * @returns {boolean}
 */
export function isClaudeCodeAvailable() {
  try {
    const result = spawnSync("claude", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Chat with Claude via the Claude Code CLI
 * @param {Object} options
 * @param {Array} options.messages - Array of message objects with role and content
 * @param {string} [options.model="sonnet"] - Model name: sonnet, opus, or haiku
 * @param {number} [options.maxTokens] - Maximum tokens in response
 * @param {number} [options.maxTurns=1] - Maximum conversation turns
 * @param {string} [options.responseFormat="json"] - Response format
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @returns {Promise<{content: any, text: string, usage: Object, raw: any}>}
 */
export async function claudeCodeChat({
  messages,
  model = "sonnet",
  maxTokens,
  maxTurns = 1,
  responseFormat = "json",
  maxRetries = 3,
}) {
  ensureJsonResponseFormat(responseFormat, "ClaudeCode");

  const { systemMsg, userMsg } = extractMessages(messages);

  const args = [
    "-p",
    userMsg,
    "--output-format",
    "json",
    "--model",
    model,
    "--max-turns",
    String(maxTurns),
  ];

  if (systemMsg) {
    args.push("--system-prompt", systemMsg);
  }

  if (maxTokens) {
    args.push("--max-tokens", String(maxTokens));
  }

  logger.log("Spawning claude CLI", { model, argsCount: args.length });

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await spawnClaude(args);
      return parseClaudeResponse(result, model);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryableError(err)) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.log(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Spawn the claude CLI and collect output
 * @param {string[]} args - CLI arguments
 * @returns {Promise<string>} - stdout content
 */
function spawnClaude(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Parse the JSON response from Claude CLI
 * @param {string} stdout - Raw stdout from CLI
 * @param {string} model - Model name for error reporting
 * @returns {{content: any, text: string, usage: Object, raw: any}}
 */
function parseClaudeResponse(stdout, model) {
  const jsonResponse = tryParseJSON(stdout);
  if (!jsonResponse) {
    throw new ProviderJsonParseError(
      "claude",
      model,
      stdout.slice(0, 200),
      "Failed to parse Claude CLI JSON response"
    );
  }

  // Extract text content from response
  const rawText = jsonResponse.result ?? jsonResponse.text ?? "";
  const cleanedText = stripMarkdownFences(rawText);
  const parsed = tryParseJSON(cleanedText) ?? cleanedText;

  return {
    content: parsed,
    text: rawText,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    raw: jsonResponse,
  };
}
