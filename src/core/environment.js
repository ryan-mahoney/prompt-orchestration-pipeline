import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";

export async function loadEnvironment(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const envFiles = options.envFiles || [".env", ".env.local"];
  const loaded = [];

  for (const envFile of envFiles) {
    const envPath = path.join(rootDir, envFile);
    if (fs.existsSync(envPath)) {
      config({ path: envPath, override: true });
      loaded.push(envFile);
    }
  }

  const warnings = validateEnvironment();
  return { loaded, warnings, config: getEnvironmentConfig() };
}

export function validateEnvironment() {
  const warnings = [];
  const commonKeys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "GEMINI_API_KEY",
  ];
  const foundKeys = commonKeys.filter((key) => process.env[key]);
  if (foundKeys.length === 0) {
    warnings.push("No LLM API keys found in environment.");
  }
  return warnings;
}

export function getEnvironmentConfig() {
  return {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORGANIZATION,
      baseURL: process.env.OPENAI_BASE_URL,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: process.env.GEMINI_BASE_URL,
    },
  };
}
