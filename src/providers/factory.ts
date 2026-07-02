import type { RuntimeConfig } from "../config/runtime.js";
import { DeepSeekProvider } from "./deepseek.js";
import { GeminiProvider } from "./gemini.js";
import { MockProvider } from "./mock.js";
import type { CouncilProvider } from "./types.js";

export function createConfiguredProviders(runtime: RuntimeConfig): CouncilProvider[] {
  const providers: CouncilProvider[] = [new MockProvider()];

  if (runtime.geminiApiKey) {
    providers.push(new GeminiProvider({
      apiKey: runtime.geminiApiKey,
      baseUrl: runtime.geminiBaseUrl,
      runtime: runtime.providerRuntime
    }));
  }

  if (runtime.deepSeekApiKey) {
    providers.push(new DeepSeekProvider({
      apiKey: runtime.deepSeekApiKey,
      baseUrl: runtime.deepSeekBaseUrl,
      runtime: runtime.providerRuntime
    }));
  }

  return providers;
}
