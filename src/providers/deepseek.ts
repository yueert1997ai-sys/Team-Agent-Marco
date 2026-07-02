import type { AgentCallResult } from "../types.js";
import { ProviderError } from "./errors.js";
import { postJson, withRetries } from "./http.js";
import { parseAndValidateStructured } from "./structured.js";
import type { CouncilProvider, ProviderRequest, ProviderRuntimeOptions } from "./types.js";

interface DeepSeekResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface DeepSeekProviderOptions {
  apiKey: string;
  baseUrl?: string;
  runtime: ProviderRuntimeOptions;
  temperature?: number;
}

export class DeepSeekProvider implements CouncilProvider {
  readonly id = "deepseek";
  private readonly baseUrl: string;

  constructor(private readonly options: DeepSeekProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("DeepSeek API key is required.");
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
  }

  async generate<T>(request: ProviderRequest): Promise<AgentCallResult<T>> {
    return withRetries(this.id, this.options.runtime, () => this.generateOnce<T>(request));
  }

  private async generateOnce<T>(request: ProviderRequest): Promise<AgentCallResult<T>> {
    const model = request.model || "deepseek-chat";
    const response = await postJson<DeepSeekResponse>(this.id, `${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "Return one valid JSON object only. It must follow the JSON Schema supplied in the user message. Do not use Markdown fences."
          },
          {
            role: "user",
            content: `${request.prompt}\n\n<required_json_schema>\n${JSON.stringify(request.options.schema)}\n</required_json_schema>`
          }
        ],
        stream: false,
        response_format: { type: "json_object" },
        max_tokens: request.options.maxOutputTokens ?? 800,
        temperature: this.options.temperature ?? 0.2
      })
    }, { ...this.options.runtime, maxRetries: 0 });

    const choice = response.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";
    if (!text) throw new ProviderError("DeepSeek returned no text", this.id, undefined, true, response);
    if (choice?.finish_reason === "length") {
      throw new ProviderError("DeepSeek output was truncated by max_tokens", this.id, undefined, true, response);
    }

    return {
      value: parseAndValidateStructured<T>(this.id, text, request.options.schema),
      usage: compactUsage(
        response.usage?.prompt_tokens,
        response.usage?.completion_tokens,
        response.usage?.total_tokens
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
