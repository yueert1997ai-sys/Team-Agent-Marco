import type { ProviderId } from "./settings.js";

export interface ProviderDetectionResult {
  provider: ProviderId;
  label: string;
  defaultModel: string;
  baseUrl: string;
}

export interface ProviderProbeOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const CANDIDATES: Array<ProviderDetectionResult> = [
  { provider: "openai", label: "OpenAI", defaultModel: "gpt-5.5", baseUrl: "https://api.openai.com/v1" },
  { provider: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", baseUrl: "https://api.deepseek.com" },
  { provider: "gemini", label: "Google Gemini", defaultModel: "gemini-3.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }
];

export async function detectProvider(apiKey: string, options: ProviderProbeOptions = {}): Promise<ProviderDetectionResult> {
  const key = apiKey.trim();
  if (!key) throw new Error("请先粘贴 API Key。");
  const ordered = key.startsWith("AIza")
    ? [CANDIDATES[2]!, CANDIDATES[0]!, CANDIDATES[1]!]
    : CANDIDATES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const results = await Promise.all(ordered.map(async (candidate) => ({
    candidate,
    ok: await probe(candidate.provider, key, timeoutMs, fetchImpl)
  })));
  const match = results.find((result) => result.ok)?.candidate;
  if (!match) {
    throw new Error("无法识别这个 Key。请确认它属于 OpenAI、Gemini 或 DeepSeek，并且仍然有效。");
  }
  return match;
}

async function probe(provider: ProviderId, apiKey: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const request = buildProbeRequest(provider, apiKey, controller.signal);
    const response = await fetchImpl(request.url, request.init);
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function buildProbeRequest(provider: ProviderId, apiKey: string, signal: AbortSignal): { url: string; init: RequestInit } {
  if (provider === "gemini") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      init: { method: "GET", signal }
    };
  }
  const baseUrl = provider === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com";
  return {
    url: `${baseUrl}/models`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal
    }
  };
}
