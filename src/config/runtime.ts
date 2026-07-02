import type { ProviderRuntimeOptions } from "../providers/types.js";

export interface RuntimeConfig {
  openAIApiKey: string;
  openAIModel: string;
  openAIBaseUrl: string;
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
  consultExperts: boolean;
}

export function readRuntimeConfig(): RuntimeConfig {
  return {
    openAIApiKey: envString("OPENAI_API_KEY"),
    openAIModel: envString("OPENAI_MODEL", "gpt-5.5"),
    openAIBaseUrl: envString("OPENAI_BASE_URL", "https://api.openai.com/v1"),
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
    budgetTokens: envInteger("CHAT_BUDGET_TOKENS", 24_000, { min: 500, max: 1_000_000 }),
    maxOutputTokens: envInteger("CHAT_MAX_OUTPUT_TOKENS", 4_000, { min: 100, max: 32_000 }),
    meetingOutputDir: envString("CHAT_OUTPUT_DIR", "conversations"),
    consultExperts: envBoolean("CONSULT_EXPERTS", true)
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

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}
