import type { AgentCallOptions, AgentCallResult } from "../types.js";

export interface ProviderRequest {
  prompt: string;
  options: AgentCallOptions;
  model: string;
}

export interface CouncilProvider {
  readonly id: string;
  generate<T>(request: ProviderRequest): Promise<AgentCallResult<T>>;
}

export interface ProviderRuntimeOptions {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}
