import type { AgentCallOptions, AgentCallResult, CouncilAgentExecutor } from "../types.js";
import type { CouncilProvider } from "./types.js";

export interface MultiProviderExecutorOptions {
  providers: CouncilProvider[];
  defaultProviderId: string;
}

export class MultiProviderExecutor implements CouncilAgentExecutor {
  private readonly providers = new Map<string, CouncilProvider>();

  constructor(private readonly options: MultiProviderExecutorOptions) {
    for (const provider of options.providers) this.providers.set(provider.id, provider);
    if (!this.providers.has(options.defaultProviderId)) {
      throw new Error(`Default provider is not configured: ${options.defaultProviderId}`);
    }
  }

  call<T>(prompt: string, options: AgentCallOptions): Promise<AgentCallResult<T>> {
    const route = parseModelRoute(options.model, this.options.defaultProviderId);
    const provider = this.providers.get(route.providerId);
    if (!provider) {
      throw new Error(
        `Provider ${JSON.stringify(route.providerId)} is not configured. Available: ${[...this.providers.keys()].join(", ")}`
      );
    }
    return provider.generate<T>({ prompt, options, model: route.model });
  }

  parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<T | null>> {
    return Promise.all(tasks.map(async (task) => {
      try {
        return await task();
      } catch {
        return null;
      }
    }));
  }
}

export function parseModelRoute(model: string | undefined, defaultProviderId: string): {
  providerId: string;
  model: string;
} {
  const value = model?.trim() ?? "";
  const slash = value.indexOf("/");
  if (slash > 0 && slash < value.length - 1) {
    return { providerId: value.slice(0, slash).toLowerCase(), model: value.slice(slash + 1) };
  }
  return { providerId: defaultProviderId, model: value };
}
