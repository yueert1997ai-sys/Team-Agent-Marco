import type { RuntimeConfig } from "../config/runtime.js";

export interface ProviderSettings {
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
}

export interface PublicAppSettings {
  gemini: ProviderSettings;
  deepSeek: ProviderSettings;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  budgetTokens: number;
  maxOutputTokens: number;
  meetingOutputDir: string;
  encryptionAvailable: boolean;
}

export interface AppSettingsPatch {
  geminiApiKey?: string;
  clearGeminiApiKey?: boolean;
  geminiModel?: string;
  geminiBaseUrl?: string;
  deepSeekApiKey?: string;
  clearDeepSeekApiKey?: boolean;
  deepSeekModel?: string;
  deepSeekBaseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  budgetTokens?: number;
  maxOutputTokens?: number;
  meetingOutputDir?: string;
}

export interface StoredAppSettings {
  version: 1;
  gemini: {
    encryptedApiKey?: string;
    model: string;
    baseUrl: string;
  };
  deepSeek: {
    encryptedApiKey?: string;
    model: string;
    baseUrl: string;
  };
  runtime: {
    timeoutMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    budgetTokens: number;
    maxOutputTokens: number;
    meetingOutputDir: string;
  };
}

export interface ResolvedSecrets {
  geminiApiKey: string;
  deepSeekApiKey: string;
}

export const DEFAULT_APP_SETTINGS: StoredAppSettings = {
  version: 1,
  gemini: {
    model: "gemini-3.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta"
  },
  deepSeek: {
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com"
  },
  runtime: {
    timeoutMs: 90_000,
    maxRetries: 2,
    retryBaseDelayMs: 800,
    budgetTokens: 12_000,
    maxOutputTokens: 900,
    meetingOutputDir: ""
  }
};

export function mergeStoredSettings(value: unknown): StoredAppSettings {
  const input = isRecord(value) ? value : {};
  const gemini = isRecord(input.gemini) ? input.gemini : {};
  const deepSeek = isRecord(input.deepSeek) ? input.deepSeek : {};
  const runtime = isRecord(input.runtime) ? input.runtime : {};

  return {
    version: 1,
    gemini: {
      ...optionalEncrypted(gemini.encryptedApiKey),
      model: asString(gemini.model, DEFAULT_APP_SETTINGS.gemini.model),
      baseUrl: normalizeUrl(asString(gemini.baseUrl, DEFAULT_APP_SETTINGS.gemini.baseUrl))
    },
    deepSeek: {
      ...optionalEncrypted(deepSeek.encryptedApiKey),
      model: asString(deepSeek.model, DEFAULT_APP_SETTINGS.deepSeek.model),
      baseUrl: normalizeUrl(asString(deepSeek.baseUrl, DEFAULT_APP_SETTINGS.deepSeek.baseUrl))
    },
    runtime: {
      timeoutMs: asInteger(runtime.timeoutMs, DEFAULT_APP_SETTINGS.runtime.timeoutMs, 5_000, 600_000),
      maxRetries: asInteger(runtime.maxRetries, DEFAULT_APP_SETTINGS.runtime.maxRetries, 0, 5),
      retryBaseDelayMs: asInteger(runtime.retryBaseDelayMs, DEFAULT_APP_SETTINGS.runtime.retryBaseDelayMs, 100, 10_000),
      budgetTokens: asInteger(runtime.budgetTokens, DEFAULT_APP_SETTINGS.runtime.budgetTokens, 500, 1_000_000),
      maxOutputTokens: asInteger(runtime.maxOutputTokens, DEFAULT_APP_SETTINGS.runtime.maxOutputTokens, 100, 4_000),
      meetingOutputDir: asString(runtime.meetingOutputDir, DEFAULT_APP_SETTINGS.runtime.meetingOutputDir)
    }
  };
}

export function applyPublicPatch(current: StoredAppSettings, patch: AppSettingsPatch): StoredAppSettings {
  return {
    version: 1,
    gemini: {
      ...(current.gemini.encryptedApiKey ? { encryptedApiKey: current.gemini.encryptedApiKey } : {}),
      model: optionalTrimmed(patch.geminiModel) ?? current.gemini.model,
      baseUrl: normalizeUrl(optionalTrimmed(patch.geminiBaseUrl) ?? current.gemini.baseUrl)
    },
    deepSeek: {
      ...(current.deepSeek.encryptedApiKey ? { encryptedApiKey: current.deepSeek.encryptedApiKey } : {}),
      model: optionalTrimmed(patch.deepSeekModel) ?? current.deepSeek.model,
      baseUrl: normalizeUrl(optionalTrimmed(patch.deepSeekBaseUrl) ?? current.deepSeek.baseUrl)
    },
    runtime: {
      timeoutMs: checkedInteger(patch.timeoutMs, current.runtime.timeoutMs, "timeoutMs", 5_000, 600_000),
      maxRetries: checkedInteger(patch.maxRetries, current.runtime.maxRetries, "maxRetries", 0, 5),
      retryBaseDelayMs: checkedInteger(patch.retryBaseDelayMs, current.runtime.retryBaseDelayMs, "retryBaseDelayMs", 100, 10_000),
      budgetTokens: checkedInteger(patch.budgetTokens, current.runtime.budgetTokens, "budgetTokens", 500, 1_000_000),
      maxOutputTokens: checkedInteger(patch.maxOutputTokens, current.runtime.maxOutputTokens, "maxOutputTokens", 100, 4_000),
      meetingOutputDir: patch.meetingOutputDir?.trim() ?? current.runtime.meetingOutputDir
    }
  };
}

export function toRuntimeConfig(
  settings: StoredAppSettings,
  secrets: ResolvedSecrets,
  defaultMeetingOutputDir: string
): RuntimeConfig {
  return {
    geminiApiKey: secrets.geminiApiKey,
    geminiModel: settings.gemini.model,
    geminiBaseUrl: settings.gemini.baseUrl,
    deepSeekApiKey: secrets.deepSeekApiKey,
    deepSeekModel: settings.deepSeek.model,
    deepSeekBaseUrl: settings.deepSeek.baseUrl,
    providerRuntime: {
      timeoutMs: settings.runtime.timeoutMs,
      maxRetries: settings.runtime.maxRetries,
      retryBaseDelayMs: settings.runtime.retryBaseDelayMs
    },
    budgetTokens: settings.runtime.budgetTokens,
    maxOutputTokens: settings.runtime.maxOutputTokens,
    meetingOutputDir: settings.runtime.meetingOutputDir || defaultMeetingOutputDir
  };
}

function checkedInteger(value: number | undefined, fallback: number, name: string, min: number, max: number): number {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalEncrypted(value: unknown): { encryptedApiKey?: string } {
  return typeof value === "string" && value.trim() ? { encryptedApiKey: value.trim() } : {};
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
