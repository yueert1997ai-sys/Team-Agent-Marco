import type { AgentCallResult } from "../types.js";
import { ProviderError } from "./errors.js";
import { postJson, withRetries } from "./http.js";
import { parseAndValidateStructured } from "./structured.js";
import type { CouncilProvider, ProviderRequest, ProviderRuntimeOptions } from "./types.js";

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

export interface GeminiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  runtime: ProviderRuntimeOptions;
  temperature?: number;
}

export class GeminiProvider implements CouncilProvider {
  readonly id = "gemini";
  private readonly baseUrl: string;

  constructor(private readonly options: GeminiProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("Gemini API key is required.");
    this.baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }

  async generate<T>(request: ProviderRequest): Promise<AgentCallResult<T>> {
    return withRetries(this.id, this.options.runtime, () => this.generateOnce<T>(request));
  }

  private async generateOnce<T>(request: ProviderRequest): Promise<AgentCallResult<T>> {
    const model = request.model || "gemini-3.5-flash";
    const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    const response = await postJson<GeminiResponse>(this.id, url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.options.apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: request.options.schema,
          maxOutputTokens: request.options.maxOutputTokens ?? 800,
          temperature: this.options.temperature ?? 0.2
        }
      })
    }, { ...this.options.runtime, maxRetries: 0 });

    const candidate = response.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    if (!text) {
      throw new ProviderError(
        `Gemini returned no text${response.promptFeedback?.blockReason ? ` (${response.promptFeedback.blockReason})` : ""}`,
        this.id,
        undefined,
        true,
        response
      );
    }
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new ProviderError("Gemini output was truncated by maxOutputTokens", this.id, undefined, true, response);
    }

    return {
      value: parseAndValidateStructured<T>(this.id, text, request.options.schema),
      usage: compactUsage(
        response.usageMetadata?.promptTokenCount,
        response.usageMetadata?.candidatesTokenCount,
        response.usageMetadata?.totalTokenCount
      )
    };
  }
}

function compactUsage(input: number | undefined, output: number | undefined, total: number | undefined) {
  return {
    ...(input != null ? { inputTokens: input } : {}),
    ...(output != null ? { outputTokens: output } : {}),
    ...(total != null ? { totalTokens: total } : {})
  };
}
