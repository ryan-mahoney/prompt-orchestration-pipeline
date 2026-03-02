import path from "node:path";
import { access } from "node:fs/promises";
import * as dotenv from "dotenv";

export interface ProviderCredentials {
  apiKey?: string;
  organization?: string;
  baseURL?: string;
}

export interface EnvironmentConfig {
  openai: ProviderCredentials;
  anthropic: Omit<ProviderCredentials, "organization">;
  deepseek: Pick<ProviderCredentials, "apiKey">;
  gemini: Omit<ProviderCredentials, "organization">;
}

export function getEnvironmentConfig(): EnvironmentConfig {
  return {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG_ID,
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

export function validateEnvironment(): string[] {
  const hasKey =
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.GEMINI_API_KEY;
  return hasKey ? [] : ["No LLM API keys found in environment."];
}

export interface LoadEnvironmentOptions {
  rootDir?: string;
  envFiles?: string[];
}

export interface LoadEnvironmentResult {
  loaded: string[];
  warnings: string[];
  config: EnvironmentConfig;
}

export async function loadEnvironment(options?: LoadEnvironmentOptions): Promise<LoadEnvironmentResult> {
  const { rootDir = process.cwd(), envFiles = [".env", ".env.local"] } = options ?? {};

  const loaded: string[] = [];
  for (const file of envFiles) {
    const resolved = path.join(rootDir, file);
    try {
      await access(resolved);
      dotenv.config({ path: resolved, override: true });
      loaded.push(file);
    } catch {
      // Missing env files are expected and should be skipped silently.
    }
  }

  const warnings = validateEnvironment();
  const config = getEnvironmentConfig();
  return { loaded, warnings, config };
}
