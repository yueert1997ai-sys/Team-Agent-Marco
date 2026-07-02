import type { RuntimeConfig } from "../config/runtime.js";

export type ProviderId = "openai" | "gemini" | "deepseek";

export interface PublicProviderSettings {
  id: ProviderId;
  label: string;
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  primary: boolean;
}

export interface PublicAppSettings {
  providers: PublicProviderSettings[];
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  budgetTokens: number;
  maxOutputTokens: number;
  conversationDirectory: string;
  consultExperts: boolean;
  encryptionAvailable: boolean;
}

export interface RuntimeSettingsPatch {
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  budgetTokens?: number;
  maxOutputTokens?: number;
  conversationDirectory?: string;
  consultExperts?: boolean;
}

export interface ProviderUpdatePatch {
  provider: ProviderId;
  model?: string;
  baseUrl?: string;
}

export interface StoredProviderSettings {
  encryptedApiKey?: string;
  model: string;
  baseUrl: string;
}

export interface StoredAppSettings {
  version: 2;
  providers: Record<ProviderId, StoredProviderSettings>;
  runtime: {
    timeoutMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    budgetTokens: number;
    maxOutputTokens: number;
    conversationDirectory: string;
    consultExperts: boolean;
  };
}

export type ResolvedSecrets = Record<ProviderId, string>;

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  deepseek: "DeepSeek"
};

export const DEFAULT_APP_SETTINGS: StoredAppSettings = {
  version: 2,
  providers: {
    openai: { model: "gpt-5.5", baseUrl: "https://api.openai.com/v1" },
    gemini: { model: "gemini-3.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com" }
  },
  runtime: {
    timeoutMs: 90_000,
    maxRetries: 2,
    retryBaseDelayMs: 800,
    budgetTokens: 24_000,
    maxOutputTokens: 4_000,
    conversationDirectory: "",
    consultExperts: true
  }
};

export function mergeStoredSettings(value: unknown): StoredAppSettings {
  const input = isRecord(value) ? value : {};
  const providers = isRecord(input.providers) ? input.providers : {};
  const legacyGemini = isRecord(input.gemini) ? input.gemini : {};
  const legacyDeepSeek = isRecord(input.deepSeek) ? input.deepSeek : {};
  const runtime = isRecord(input.runtime) ? input.runtime : {};
  return {
    version: 2,
    providers: {
      openai: { ...readProvider(providers.openai, DEFAULT_APP_SETTINGS.providers.openai), model: "gpt-5.5" },
      gemini: readProvider(providers.gemini ?? legacyGemini, DEFAULT_APP_SETTINGS.providers.gemini),
      deepseek: readProvider(providers.deepseek ?? legacyDeepSeek, DEFAULT_APP_SETTINGS.providers.deepseek)
    },
    runtime: {
      timeoutMs: asInteger(runtime.timeoutMs, DEFAULT_APP_SETTINGS.runtime.timeoutMs, 5_000, 600_000),
      maxRetries: asInteger(runtime.maxRetries, DEFAULT_APP_SETTINGS.runtime.maxRetries, 0, 5),
      retryBaseDelayMs: asInteger(runtime.retryBaseDelayMs, DEFAULT_APP_SETTINGS.runtime.retryBaseDelayMs, 100, 10_000),
      budgetTokens: asInteger(runtime.budgetTokens, DEFAULT_APP_SETTINGS.runtime.budgetTokens, 500, 1_000_000),
      maxOutputTokens: asInteger(runtime.maxOutputTokens, DEFAULT_APP_SETTINGS.runtime.maxOutputTokens, 100, 32_000),
      conversationDirectory: asOptionalString(runtime.conversationDirectory ?? runtime.meetingOutputDir),
      consultExperts: typeof runtime.consultExperts === "boolean" ? runtime.consultExperts : true
    }
  };
}

export function applyRuntimePatch(current: StoredAppSettings, patch: RuntimeSettingsPatch): StoredAppSettings {
  return {
    ...current,
    runtime: {
      timeoutMs: checkedInteger(patch.timeoutMs, current.runtime.timeoutMs, "timeoutMs", 5_000, 600_000),
      maxRetries: checkedInteger(patch.maxRetries, current.runtime.maxRetries, "maxRetries", 0, 5),
      retryBaseDelayMs: checkedInteger(patch.retryBaseDelayMs, current.runtime.retryBaseDelayMs, "retryBaseDelayMs", 100, 10_000),
      budgetTokens: checkedInteger(patch.budgetTokens, current.runtime.budgetTokens, "budgetTokens", 500, 1_000_000),
      maxOutputTokens: checkedInteger(patch.maxOutputTokens, current.runtime.maxOutputTokens, "maxOutputTokens", 100, 32_000),
      conversationDirectory: patch.conversationDirectory?.trim() ?? current.runtime.conversationDirectory,
      consultExperts: patch.consultExperts ?? current.runtime.consultExperts
    }
  };
}

export function applyProviderUpdate(current: StoredAppSettings, patch: ProviderUpdatePatch): StoredAppSettings {
  const previous = current.providers[patch.provider];
  return {
    ...current,
    providers: {
      ...current.providers,
      [patch.provider]: {
        ...(previous.encryptedApiKey ? { encryptedApiKey: previous.encryptedApiKey } : {}),
        model: patch.provider === "openai" ? "gpt-5.5" : optionalTrimmed(patch.model) ?? previous.model,
        baseUrl: normalizeUrl(optionalTrimmed(patch.baseUrl) ?? previous.baseUrl)
      }
    }
  };
}

export function toRuntimeConfig(settings: StoredAppSettings, secrets: ResolvedSecrets, defaultConversationDirectory: string): RuntimeConfig {
  return {
    openAIApiKey: secrets.openai,
    openAIModel: "gpt-5.5",
    openAIBaseUrl: settings.providers.openai.baseUrl,
    geminiApiKey: secrets.gemini,
    geminiModel: settings.providers.gemini.model,
    geminiBaseUrl: settings.providers.gemini.baseUrl,
    deepSeekApiKey: secrets.deepseek,
    deepSeekModel: settings.providers.deepseek.model,
    deepSeekBaseUrl: settings.providers.deepseek.baseUrl,
    providerRuntime: {
      timeoutMs: settings.runtime.timeoutMs,
      maxRetries: settings.runtime.maxRetries,
      retryBaseDelayMs: settings.runtime.retryBaseDelayMs
    },
    budgetTokens: settings.runtime.budgetTokens,
    maxOutputTokens: settings.runtime.maxOutputTokens,
    meetingOutputDir: settings.runtime.conversationDirectory || defaultConversationDirectory,
    consultExperts: settings.runtime.consultExperts
  };
}

export function toPublicSettings(settings: StoredAppSettings, defaultConversationDirectory: string, encryptionAvailable: boolean): PublicAppSettings {
  const providers = (Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    model: settings.providers[id].model,
    baseUrl: settings.providers[id].baseUrl,
    apiKeyConfigured: Boolean(settings.providers[id].encryptedApiKey),
    primary: id === "openai"
  }));
  return {
    providers,
    timeoutMs: settings.runtime.timeoutMs,
    maxRetries: settings.runtime.maxRetries,
    retryBaseDelayMs: settings.runtime.retryBaseDelayMs,
    budgetTokens: settings.runtime.budgetTokens,
    maxOutputTokens: settings.runtime.maxOutputTokens,
    conversationDirectory: settings.runtime.conversationDirectory || defaultConversationDirectory,
    consultExperts: settings.runtime.consultExperts,
    encryptionAvailable
  };
}

function readProvider(value: unknown, fallback: StoredProviderSettings): StoredProviderSettings {
  const input = isRecord(value) ? value : {};
  return {
    ...optionalEncrypted(input.encryptedApiKey),
    model: asString(input.model, fallback.model),
    baseUrl: normalizeUrl(asString(input.baseUrl, fallback.baseUrl))
  };
}
function checkedInteger(value: number | undefined, fallback: number, name: string, min: number, max: number): number {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function asString(value: unknown, fallback: string): string { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function asOptionalString(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function optionalEncrypted(value: unknown): { encryptedApiKey?: string } { return typeof value === "string" && value.trim() ? { encryptedApiKey: value.trim() } : {}; }
function optionalTrimmed(value: string | undefined): string | undefined { const trimmed = value?.trim(); return trimmed ? trimmed : undefined; }
function normalizeUrl(value: string): string { return value.replace(/\/+$/, ""); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
