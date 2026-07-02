import type { ProviderRuntimeOptions } from "../providers/types.js";

export interface RuntimeConfig {
  geminiApiKey: string;
  geminiModel: string;
  geminiBaseUrl: string;
  deepSeekApiKey: string;
  deepSeekModel: string;
  deepSeekBaseUrl: string;
  providerRuntime: ProviderRuntimeOptions;
  budgetTokens: number;
  maxOutputTokens: number;
  meetingOutputDir: string;
}

export function readRuntimeConfig(): RuntimeConfig {
  return {
    geminiApiKey: envString("GEMINI_API_KEY"),
    geminiModel: envString("GEMINI_MODEL", "gemini-3.5-flash"),
    geminiBaseUrl: envString("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"),
    deepSeekApiKey: envString("DEEPSEEK_API_KEY"),
    deepSeekModel: envString("DEEPSEEK_MODEL", "deepseek-chat"),
    deepSeekBaseUrl: envString("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    providerRuntime: {
      timeoutMs: envInteger("API_TIMEOUT_MS", 90_000, { min: 5_000, max: 600_000 }),
      maxRetries: envInteger("API_MAX_RETRIES", 2, { min: 0, max: 5 }),
      retryBaseDelayMs: envInteger("API_RETRY_BASE_DELAY_MS", 800, { min: 100, max: 10_000 })
    },
    budgetTokens: envInteger("COUNCIL_BUDGET_TOKENS", 12_000, { min: 500, max: 1_000_000 }),
    maxOutputTokens: envInteger("COUNCIL_MAX_OUTPUT_TOKENS", 900, { min: 100, max: 4_000 }),
    meetingOutputDir: envString("COUNCIL_OUTPUT_DIR", "meetings")
  };
}

function envString(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function envInteger(name: string, fallback: number, range?: { min?: number; max?: number }): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  if (range?.min != null && value < range.min) throw new Error(`${name} must be >= ${range.min}.`);
  if (range?.max != null && value > range.max) throw new Error(`${name} must be <= ${range.max}.`);
  return value;
}
